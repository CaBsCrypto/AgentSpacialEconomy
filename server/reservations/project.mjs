import { canonical, exactKeys, fail, hexId, requireHost, sha256, text, uuid } from '../identity/common.mjs';
import { requireCapability } from './config.mjs';
import { lock } from './db.mjs';
export function createProjectService({ db, config, storage, resources, now = Date.now, decode = decodeImage }) {
  async function row(tx = db) {
    const initial = { title:'', context:'', spaces:[], map:null };
    await tx.query('INSERT INTO reservation_projects(id,owner_address,data) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[config.projectId,config.hostAddress,initial]);
    const value = (await tx.query('SELECT * FROM reservation_projects WHERE id=$1',[config.projectId])).rows[0];
    if (value.owner_address !== config.hostAddress) fail(503,'PROJECT_OWNER_MISMATCH','The configured host does not own this project.');
    return value;
  }
  function host(identity, capability = 'project') { requireHost(identity,config); requireCapability(config,capability,now()); }
  async function get(identity) {
    host(identity,'reading'); const value = await row();
    const messages = (await db.query('SELECT id,role,content,created_at FROM reservation_messages WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 60',[config.projectId])).rows.reverse();
    const snapshot=value.approved_snapshot_id ? (await db.query('SELECT data FROM reservation_snapshots WHERE id=$1',[value.approved_snapshot_id])).rows[0]?.data : null;
    return { id:value.id, revision:value.revision, ...value.data, editorialState:value.approved_snapshot_id ? 'APPROVED':'DRAFT', approvedSnapshotId:value.approved_snapshot_id, approvedSnapshot:snapshot??null, conversation:messages.map(message => ({ id:message.id, role:message.role, content:message.content, createdAt:new Date(message.created_at).toISOString() })) };
  }
  async function update(identity,input) {
    host(identity); exactKeys(input,['expectedRevision','title','context','spaces','map']);
    return db.transaction(async tx => {
      await lock(tx,'project:'+config.projectId); const old = await row(tx);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== old.revision) fail(409,'REVISION_CONFLICT','The project changed. Reload before applying edits.');
      if (!Array.isArray(input.spaces) || input.spaces.length > config.limits.spaces) fail(422,'SPACES_LIMIT','Use at most twenty spaces.');
      const seen = new Set();
      const spaces = input.spaces.map(space => {
        exactKeys(space,['name','purpose'],['id']);
        const id = space.id === undefined ? uuid() : hexId(space.id);
        if (space.id && !old.data.spaces.some(existing => existing.id === id)) fail(422,'UNKNOWN_SPACE','The space does not belong to this project.');
        if (seen.has(id)) fail(422,'DUPLICATE_SPACE','Each space must appear once.'); seen.add(id);
        return { id, name:text(space.name,80), purpose:text(space.purpose,500,false) };
      });
      let map = null;
      if (input.map !== null) {
        exactKeys(input.map,['mediaId','points']); const mediaId = hexId(input.map.mediaId);
        if (!(await tx.query("SELECT id FROM reservation_media WHERE id=$1 AND project_id=$2 AND owner_address=$3 AND state='READY'",[mediaId,config.projectId,identity.address])).rows.length) fail(404,'MEDIA_NOT_FOUND','The project image was not found.');
        if (!Array.isArray(input.map.points) || input.map.points.length > spaces.length) fail(422,'INVALID_MAP','The map contains invalid points.');
        const placed = new Set();
        map = { mediaId, points:input.map.points.map(point => {
          exactKeys(point,['spaceId','x','y']);
          if (!seen.has(point.spaceId) || placed.has(point.spaceId) || ![point.x,point.y].every(n => Number.isFinite(n) && n>=0 && n<=1)) fail(422,'INVALID_MAP','Use one normalized point per project space.');
          placed.add(point.spaceId); return { spaceId:point.spaceId,x:point.x,y:point.y };
        }) };
      }
      const data = { title:text(input.title,120),context:text(input.context,4000,false),spaces,map };
      if (canonical(data) === canonical(old.data)) return { id:old.id,revision:old.revision,...data,editorialState:old.approved_snapshot_id?'APPROVED':'DRAFT',approvedSnapshotId:old.approved_snapshot_id };
      await tx.query('UPDATE reservation_projects SET data=$2,revision=revision+1,approved_snapshot_id=NULL,updated_at=now() WHERE id=$1',[config.projectId,data]);
      return { id:old.id,revision:old.revision+1,...data,editorialState:'DRAFT',approvedSnapshotId:null };
    });
  }
  async function approve(identity,input) {
    host(identity); exactKeys(input,['expectedRevision','spaceId']); hexId(input.spaceId);
    return db.transaction(async tx => {
      await lock(tx,'project:'+config.projectId); const project = await row(tx);
      if (input.expectedRevision !== project.revision) fail(409,'REVISION_CONFLICT','Reload the project before approval.');
      const space = project.data.spaces.find(value => value.id === input.spaceId);
      if (!space || !project.data.title || !project.data.map?.points.some(point => point.spaceId === space.id)) fail(422,'REVIEW_INCOMPLETE','Review a title, space and map position before approval.');
      const previous = (await tx.query('SELECT data FROM reservation_snapshots WHERE project_id=$1 AND revision=$2',[config.projectId,project.revision])).rows[0];
      if (previous) { if (previous.data.spaceId !== space.id) fail(409,'REVISION_ALREADY_APPROVED','This revision already has a different immutable offer. Edit the project before another approval.'); return previous.data; }
      const content = { projectId:config.projectId,revision:project.revision,spaceId:space.id,title:project.data.title,context:project.data.context,space,map:{mediaId:project.data.map.mediaId,points:project.data.map.points.filter(point=>point.spaceId===space.id)} };
      const snapshot = { id:uuid(),...content,contentHash:sha256(canonical(content)),approvedAt:new Date(now()).toISOString() };
      await tx.query('INSERT INTO reservation_snapshots(id,project_id,revision,data,content_hash,approved_at) VALUES($1,$2,$3,$4,$5,$6)',[snapshot.id,config.projectId,project.revision,snapshot,snapshot.contentHash,snapshot.approvedAt]);
      await tx.query('UPDATE reservation_projects SET approved_snapshot_id=$2,updated_at=now() WHERE id=$1',[config.projectId,snapshot.id]);
      return snapshot;
    });
  }
  async function upload(identity,bytes,mime) {
    host(identity,'media'); await row();
    await db.transaction(async tx=>{await lock(tx,'project:'+config.projectId);await tx.query('UPDATE reservation_projects SET updated_at=now() WHERE id=$1',[config.projectId]);});
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>config.limits.uploadBytes) fail(413,'UPLOAD_SIZE','Upload at most 2 MiB.');
    const decoded = await decode(bytes,mime,config.limits);
    await resources.reserve([{resource:'blobWriteBytes',amount:decoded.bytes.length}]);
    const id = uuid(), key='reservations/'+id+'.png';
    await db.query("INSERT INTO reservation_media(id,project_id,owner_address,storage_key,content_hash,byte_size,state,width,height) VALUES($1,$2,$3,$4,$5,$6,'STAGED',$7,$8)",[id,config.projectId,identity.address,key,sha256(decoded.bytes),decoded.bytes.length,decoded.width,decoded.height]);
    const stored = await storage.put(decoded.bytes,id);
    if (stored.key!==key) fail(503,'MEDIA_STORAGE_MISMATCH','The private storage returned a different asset reference.');
    await db.query("UPDATE reservation_media SET state='READY' WHERE id=$1 AND state='STAGED'",[id]);
    return { id,width:decoded.width,height:decoded.height,mime:'image/png' };
  }
  async function readMedia(identity,id) {
    host(identity,'mediaRead'); hexId(id);
    const media = (await db.query("SELECT * FROM reservation_media WHERE id=$1 AND owner_address=$2 AND project_id=$3 AND state='READY'",[id,identity.address,config.projectId])).rows[0];
    return readStored(media);
  }
  async function readStored(media) {
    if (!media) fail(404,'MEDIA_NOT_FOUND','The image was not found.');
    if (media.state!=='READY') fail(404,'MEDIA_NOT_FOUND','The image is not ready.');
    await resources.reserve([{resource:'blobReadBytes',amount:media.byte_size}]);
    const bytes = Buffer.from(await storage.get(media.storage_key,media.byte_size));
    if (sha256(bytes)!==media.content_hash) fail(503,'MEDIA_INTEGRITY','The stored image failed its integrity check.');
    return bytes;
  }
  return { get,update,approve,upload,readMedia,readStored, row };
}
export async function decodeImage(bytes,mime,limits) {
  const expected = { 'image/png':'png','image/jpeg':'jpeg','image/webp':'webp' }[mime];
  if (!expected) fail(422,'UPLOAD_TYPE','Choose PNG, JPEG or WebP.');
  try {
    const sharp = (await import('sharp')).default;
    const options = { limitInputPixels:limits.imageWidth*limits.imageHeight,failOn:'warning',animated:false };
    const meta = await sharp(bytes,options).metadata();
    if (meta.format!==expected || !meta.width || !meta.height || meta.width>limits.imageWidth || meta.height>limits.imageHeight || (meta.pages ?? 1)!==1) fail(422,'IMAGE_DIMENSIONS','The decoded image exceeds the allowed dimensions or format.');
    const {data,info} = await sharp(bytes,options).rotate().png().toBuffer({resolveWithObject:true});
    if (info.width>limits.imageWidth || info.height>limits.imageHeight || data.length>limits.uploadBytes) fail(413,'IMAGE_SIZE','The normalized image exceeds the allowed size.');
    return { bytes:data,width:info.width,height:info.height };
  } catch(error) { if (error.status) throw error; fail(422,'IMAGE_DECODE_FAILED','The image could not be safely decoded.'); }
}
