#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, xdr::ToXdr, Address,
    Bytes, BytesN, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Plan {
    Time,
    Passes,
    Exclusive,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Placement {
    pub slot: Symbol,
    pub plan: Plan,
    pub units: u64,
    pub pass_ms: u32,
    pub start: u64,
    pub end: u64,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Commitment {
    pub order: BytesN<32>,
    pub revision: BytesN<32>,
    pub terms: BytesN<32>,
    pub manifest: BytesN<32>,
    pub payment: BytesN<32>,
    pub claimant: Address,
    pub deadline: u64,
    pub placements: Vec<Placement>,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Evidence {
    pub order: BytesN<32>,
    pub nonce: u64,
    pub placement: u32,
    pub revision: BytesN<32>,
    pub manifest: BytesN<32>,
    pub segment: BytesN<32>,
    pub start: u64,
    pub end: u64,
    pub units: u64,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Queued,
    Partial,
    Completed,
    Disputed,
    Expired,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Record {
    pub commitment: Commitment,
    pub state: Status,
    pub delivered: Vec<u64>,
    pub last_end: Vec<u64>,
    pub next_nonce: u64,
    pub resolution: Option<BytesN<32>>,
}
#[contracttype]
#[derive(Clone)]
enum Key {
    Issuer,
    Publisher,
    Order(BytesN<32>),
    Segment(BytesN<32>, u32, BytesN<32>),
}
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Invalid = 1,
    Duplicate = 2,
    Missing = 3,
    Closed = 4,
    Replay = 5,
    Incomplete = 6,
    OutsideWindow = 7,
    Premature = 8,
}
#[contract]
pub struct AdsRegistry;
fn issuer(e: &Env) {
    let a: Address = e.storage().instance().get(&Key::Issuer).unwrap();
    a.require_auth();
}
fn load(e: &Env, id: &BytesN<32>) -> Record {
    e.storage()
        .persistent()
        .get(&Key::Order(id.clone()))
        .unwrap_or_else(|| panic_with_error!(e, Error::Missing))
}
fn save(e: &Env, r: &Record) {
    let key = Key::Order(r.commitment.order.clone());
    e.storage().persistent().set(&key, r);
    e.storage().persistent().extend_ttl(&key, 100_000, 100_000);
}
fn active(e: &Env, r: &Record) {
    if r.state != Status::Queued && r.state != Status::Partial {
        panic_with_error!(e, Error::Closed);
    }
}
fn check(e: &Env, yes: bool, err: Error) {
    if !yes {
        panic_with_error!(e, err);
    }
}

#[contractimpl]
impl AdsRegistry {
    pub fn __constructor(e: Env, issuer: Address, publisher: BytesN<32>) {
        e.storage().instance().set(&Key::Issuer, &issuer);
        e.storage().instance().set(&Key::Publisher, &publisher);
    }
    pub fn commit(e: Env, c: Commitment) {
        issuer(&e);
        check(
            &e,
            !e.storage().persistent().has(&Key::Order(c.order.clone())),
            Error::Duplicate,
        );
        check(
            &e,
            c.placements.len() > 0
                && c.placements.len() <= 2
                && c.deadline > (e.ledger().timestamp() * 1000),
            Error::Invalid,
        );
        let mut delivered = Vec::new(&e);
        let mut last_end = Vec::new(&e);
        for (i, p) in c.placements.iter().enumerate() {
            check(
                &e,
                p.slot == Symbol::new(&e, "venue_center_banner")
                    || p.slot == Symbol::new(&e, "main_stage_screen"),
                Error::Invalid,
            );
            for prev in c.placements.iter().take(i) {
                check(&e, prev.slot != p.slot, Error::Duplicate);
            }
            check(
                &e,
                p.units > 0 && p.end > p.start && p.end <= c.deadline,
                Error::Invalid,
            );
            let seconds = p.end - p.start;
            match p.plan {
                Plan::Time => check(&e, p.units <= seconds, Error::Invalid),
                Plan::Passes => check(
                    &e,
                    p.pass_ms > 0
                        && p.units
                            .checked_mul(p.pass_ms as u64)
                            .map(|n| n <= seconds)
                            .unwrap_or(false),
                    Error::Invalid,
                ),
                Plan::Exclusive => check(&e, p.units == seconds, Error::Invalid),
            }
            delivered.push_back(0);
            last_end.push_back(p.start);
        }
        let r = Record {
            commitment: c.clone(),
            state: Status::Queued,
            delivered,
            last_end,
            next_nonce: 0,
            resolution: None,
        };
        save(&e, &r);
        e.events()
            .publish((Symbol::new(&e, "queued"), c.order), c.terms);
    }
    pub fn record_delivery(e: Env, proof: Evidence, signature: BytesN<64>) {
        let mut r = load(&e, &proof.order);
        active(&e, &r);
        check(
            &e,
            (e.ledger().timestamp() * 1000) <= r.commitment.deadline,
            Error::Closed,
        );
        check(&e, proof.nonce == r.next_nonce, Error::Replay);
        check(
            &e,
            proof.revision == r.commitment.revision && proof.manifest == r.commitment.manifest,
            Error::Invalid,
        );
        let p = r
            .commitment
            .placements
            .get(proof.placement)
            .unwrap_or_else(|| panic_with_error!(&e, Error::Invalid));
        let key = Key::Segment(proof.order.clone(), proof.placement, proof.segment.clone());
        check(&e, !e.storage().persistent().has(&key), Error::Replay);
        check(
            &e,
            proof.end > proof.start
                && proof.start >= p.start
                && proof.end <= p.end
                && proof.end <= (e.ledger().timestamp() * 1000)
                && proof.start >= r.last_end.get(proof.placement).unwrap(),
            Error::OutsideWindow,
        );
        let units = match p.plan {
            Plan::Passes => {
                check(
                    &e,
                    proof.end - proof.start == p.pass_ms as u64,
                    Error::Invalid,
                );
                1
            }
            _ => proof.end - proof.start,
        };
        check(&e, proof.units == units, Error::Invalid);
        let total = r
            .delivered
            .get(proof.placement)
            .unwrap()
            .checked_add(units)
            .unwrap_or_else(|| panic_with_error!(&e, Error::Invalid));
        check(&e, total <= p.units, Error::Invalid);
        let domain = Symbol::new(&e, "ads_delivery_v1");
        let message = (
            domain,
            e.ledger().network_id(),
            e.current_contract_address(),
            proof.clone(),
        )
            .to_xdr(&e);
        let digest = e.crypto().sha256(&message);
        let publisher: BytesN<32> = e.storage().instance().get(&Key::Publisher).unwrap();
        e.crypto().ed25519_verify(
            &publisher,
            &Bytes::from_array(&e, &digest.to_array()),
            &signature,
        );
        r.delivered.set(proof.placement, total);
        r.last_end.set(proof.placement, proof.end);
        r.next_nonce = r.next_nonce.checked_add(1).unwrap();
        r.state = Status::Partial;
        e.storage().persistent().set(&key, &true);
        e.storage().persistent().extend_ttl(&key, 100_000, 100_000);
        save(&e, &r);
        e.events().publish(
            (Symbol::new(&e, "attested"), proof.order),
            (proof.placement, proof.segment, proof.units),
        );
    }
    pub fn complete(e: Env, order: BytesN<32>) {
        let mut r = load(&e, &order);
        active(&e, &r);
        for (i, p) in r.commitment.placements.iter().enumerate() {
            check(
                &e,
                r.delivered.get(i as u32).unwrap() == p.units,
                Error::Incomplete,
            );
        }
        r.state = Status::Completed;
        save(&e, &r);
        e.events()
            .publish((Symbol::new(&e, "completed"), order), r.commitment.manifest);
    }
    /// The configured issuer relays an authenticated off-chain dispute; no funds are frozen.
    pub fn dispute(e: Env, order: BytesN<32>) {
        issuer(&e);
        let mut r = load(&e, &order);
        check(&e, r.state != Status::Disputed, Error::Duplicate);
        r.state = Status::Disputed;
        save(&e, &r);
        e.events()
            .publish((Symbol::new(&e, "disputed"), order), r.commitment.claimant);
    }
    /// Issuer records the explicit off-chain resolution hash; delivery evidence is unchanged.
    pub fn resolve_dispute(e: Env, order: BytesN<32>, remedy_hash: BytesN<32>) {
        issuer(&e);
        let mut r = load(&e, &order);
        check(&e, r.state == Status::Disputed, Error::Closed);
        r.state = if r.delivered.iter().any(|units| units > 0) {
            Status::Partial
        } else {
            Status::Queued
        };
        r.resolution = Some(remedy_hash.clone());
        save(&e, &r);
        e.events()
            .publish((Symbol::new(&e, "resolved"), order), remedy_hash);
    }
    /// A keeper must invoke this; contracts do not run themselves.
    pub fn expire(e: Env, order: BytesN<32>) {
        let mut r = load(&e, &order);
        active(&e, &r);
        check(
            &e,
            (e.ledger().timestamp() * 1000) > r.commitment.deadline,
            Error::Premature,
        );
        r.state = Status::Expired;
        save(&e, &r);
        e.events()
            .publish((Symbol::new(&e, "expired"), order), r.delivered);
    }
    pub fn get(e: Env, order: BytesN<32>) -> Record {
        load(&e, &order)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        vec,
    };
    fn setup() -> (Env, Address, SigningKey, Commitment) {
        let e = Env::default();
        e.mock_all_auths();
        e.ledger().with_mut(|l| {
            l.timestamp = 200;
            l.sequence_number = 100;
        });
        let signing = SigningKey::from_bytes(&[7; 32]);
        let id = e.register(
            AdsRegistry,
            (
                Address::generate(&e),
                BytesN::from_array(&e, &signing.verifying_key().to_bytes()),
            ),
        );
        let c = Commitment {
            order: BytesN::from_array(&e, &[1; 32]),
            revision: BytesN::from_array(&e, &[2; 32]),
            terms: BytesN::from_array(&e, &[3; 32]),
            manifest: BytesN::from_array(&e, &[4; 32]),
            payment: BytesN::from_array(&e, &[5; 32]),
            claimant: Address::generate(&e),
            deadline: 400000,
            placements: vec![
                &e,
                Placement {
                    slot: Symbol::new(&e, "venue_center_banner"),
                    plan: Plan::Time,
                    units: 10000,
                    pass_ms: 0,
                    start: 200000,
                    end: 300000,
                },
            ],
        };
        (e, id, signing, c)
    }
    fn signed(e: &Env, client: &AdsRegistryClient, key: &SigningKey, p: &Evidence) -> BytesN<64> {
        let message = (
            Symbol::new(e, "ads_delivery_v1"),
            e.ledger().network_id(),
            client.address.clone(),
            p.clone(),
        )
            .to_xdr(e);
        let digest = e.crypto().sha256(&message);
        BytesN::from_array(e, &key.sign(&digest.to_array()).to_bytes())
    }
    fn proof(e: &Env, c: &Commitment) -> Evidence {
        Evidence {
            order: c.order.clone(),
            nonce: 0,
            placement: 0,
            revision: c.revision.clone(),
            manifest: c.manifest.clone(),
            segment: BytesN::from_array(e, &[8; 32]),
            start: 200000,
            end: 210000,
            units: 10000,
        }
    }
    #[test]
    fn queued_is_not_delivery_and_full_attestation_completes() {
        let (e, id, key, c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        client.commit(&c);
        assert_eq!(client.get(&c.order).state, Status::Queued);
        assert!(client.try_complete(&c.order).is_err());
        e.ledger().with_mut(|l| l.timestamp = 220);
        let p = proof(&e, &c);
        client.record_delivery(&p, &signed(&e, &client, &key, &p));
        assert!(client
            .try_record_delivery(&p, &signed(&e, &client, &key, &p))
            .is_err());
        client.complete(&c.order);
        assert_eq!(client.get(&c.order).state, Status::Completed);
    }
    #[test]
    fn invalid_signer_and_hash_fail_closed() {
        let (e, id, _, c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        client.commit(&c);
        e.ledger().with_mut(|l| l.timestamp = 220);
        let p = proof(&e, &c);
        let wrong = SigningKey::from_bytes(&[9; 32]);
        assert!(client
            .try_record_delivery(&p, &signed(&e, &client, &wrong, &p))
            .is_err());
        assert_eq!(client.get(&c.order).delivered.get(0), Some(0));
    }
    #[test]
    fn dispute_and_expiry_preserve_unfulfilled_units() {
        let (e, id, _, c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        client.commit(&c);
        assert!(client.try_expire(&c.order).is_err());
        e.ledger().with_mut(|l| l.timestamp = 401);
        client.expire(&c.order);
        assert_eq!(client.get(&c.order).state, Status::Expired);
        client.dispute(&c.order);
        assert!(client.try_complete(&c.order).is_err());
        assert_eq!(client.get(&c.order).delivered.get(0), Some(0));
    }

    #[test]
    fn interrupted_pass_is_zero_and_complete_passes_are_unique() {
        let (e, id, key, mut c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        let mut slot = c.placements.get(0).unwrap();
        slot.plan = Plan::Passes;
        slot.units = 2;
        slot.pass_ms = 1000;
        c.placements.set(0, slot);
        client.commit(&c);
        e.ledger().with_mut(|l| l.timestamp = 220);
        let mut p = proof(&e, &c);
        p.units = 1;
        p.end = 200500;
        assert!(client
            .try_record_delivery(&p, &signed(&e, &client, &key, &p))
            .is_err());
        assert_eq!(client.get(&c.order).delivered.get(0), Some(0));
        p.end = 201000;
        client.record_delivery(&p, &signed(&e, &client, &key, &p));
        assert!(client.try_complete(&c.order).is_err());
        p.nonce = 1;
        p.segment = BytesN::from_array(&e, &[9; 32]);
        p.start = 201000;
        p.end = 202000;
        client.record_delivery(&p, &signed(&e, &client, &key, &p));
        client.complete(&c.order);
        assert_eq!(client.get(&c.order).delivered.get(0), Some(2));
    }
    #[test]
    fn overlapping_time_never_increases_delivery() {
        let (e, id, key, mut c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        let mut slot = c.placements.get(0).unwrap();
        slot.units = 20000;
        c.placements.set(0, slot);
        client.commit(&c);
        e.ledger().with_mut(|l| l.timestamp = 220);
        let mut p = proof(&e, &c);
        client.record_delivery(&p, &signed(&e, &client, &key, &p));
        p.nonce = 1;
        p.segment = BytesN::from_array(&e, &[9; 32]);
        p.start = 205000;
        p.end = 215000;
        assert!(client
            .try_record_delivery(&p, &signed(&e, &client, &key, &p))
            .is_err());
        assert_eq!(client.get(&c.order).delivered.get(0), Some(10000));
        p.start = 210000;
        p.end = 220000;
        client.record_delivery(&p, &signed(&e, &client, &key, &p));
        client.complete(&c.order);
    }
    #[test]
    fn interrupted_exclusive_keeps_deficit_after_expiry() {
        let (e, id, key, mut c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        let mut slot = c.placements.get(0).unwrap();
        slot.plan = Plan::Exclusive;
        slot.units = 100000;
        c.placements.set(0, slot);
        client.commit(&c);
        e.ledger().with_mut(|l| l.timestamp = 220);
        let p = proof(&e, &c);
        client.record_delivery(&p, &signed(&e, &client, &key, &p));
        assert!(client.try_complete(&c.order).is_err());
        e.ledger().with_mut(|l| l.timestamp = 401);
        client.expire(&c.order);
        assert_eq!(client.get(&c.order).delivered.get(0), Some(10000));
        assert_eq!(client.get(&c.order).state, Status::Expired);
    }
    #[test]
    fn signature_from_another_registry_cannot_be_replayed() {
        let (e, id, key, c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        client.commit(&c);
        let other_id = e.register(
            AdsRegistry,
            (
                Address::generate(&e),
                BytesN::from_array(&e, &key.verifying_key().to_bytes()),
            ),
        );
        let other = AdsRegistryClient::new(&e, &other_id);
        other.commit(&c);
        e.ledger().with_mut(|l| l.timestamp = 220);
        let p = proof(&e, &c);
        assert!(other
            .try_record_delivery(&p, &signed(&e, &client, &key, &p))
            .is_err());
        assert_eq!(other.get(&c.order).next_nonce, 0);
    }

    #[test]
    fn explicit_dispute_resolution_preserves_evidence_and_never_completes_a_deficit() {
        let (e, id, key, c) = setup();
        let client = AdsRegistryClient::new(&e, &id);
        client.commit(&c);
        client.dispute(&c.order);
        let remedy = BytesN::from_array(&e, &[11; 32]);
        client.resolve_dispute(&c.order, &remedy);
        assert_eq!(client.get(&c.order).state, Status::Queued);
        assert_eq!(client.get(&c.order).resolution, Some(remedy));
        assert!(client.try_complete(&c.order).is_err());
        e.ledger().with_mut(|l| l.timestamp = 220);
        let p = proof(&e, &c);
        client.record_delivery(&p, &signed(&e, &client, &key, &p));
        client.dispute(&c.order);
        client.resolve_dispute(&c.order, &BytesN::from_array(&e, &[12; 32]));
        assert_eq!(client.get(&c.order).delivered.get(0), Some(10000));
        client.complete(&c.order);
        assert_eq!(client.get(&c.order).state, Status::Completed);
    }
}
