//! Exclusive space reservation: one host, one project, host-defined offers, one holder per offer.
//!
//! Scope follows the Instawards SOW (docs/instawards/SOW-v0.7): the contract holds no funds and
//! records only opaque IDs, accounts, states and events. RESERVED is final. There are no time slots,
//! no overlap detection and no cancellation in this sprint. The contract cannot certify venue rights,
//! physical availability or delivery.
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    WrongProject = 3,
    DuplicateOffer = 4,
    UnknownOffer = 5,
    AlreadyReserved = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum State {
    Available,
    Reserved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Offer {
    pub offer: BytesN<32>,
    pub project: BytesN<32>,
    pub space: BytesN<32>,
    pub host: Address,
    pub state: State,
    pub holder: Option<Address>,
    pub published_at: u64,
    pub reserved_at: u64,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Project,
    Host,
    Offer(BytesN<32>),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Published {
    #[topic]
    pub offer: BytesN<32>,
    pub project: BytesN<32>,
    pub host: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reserved {
    #[topic]
    pub offer: BytesN<32>,
    pub holder: Address,
}

#[contract]
pub struct Reservation;

#[contractimpl]
impl Reservation {
    /// One-time initialization: binds this instance to one project and one authorized host.
    /// A second call fails; the first host and project are never overwritten.
    pub fn __constructor(env: Env, project: BytesN<32>, host: Address) {
        if env.storage().instance().has(&Key::Project) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        host.require_auth();
        env.storage().instance().set(&Key::Project, &project);
        env.storage().instance().set(&Key::Host, &host);
    }

    /// The authorized host publishes an opaque offer id for one reference space as AVAILABLE.
    /// Reused ids are rejected without touching the existing record.
    pub fn publish(env: Env, project: BytesN<32>, offer: BytesN<32>, space: BytesN<32>) -> Offer {
        let host: Address = env
            .storage()
            .instance()
            .get(&Key::Host)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        host.require_auth();
        let bound: BytesN<32> = env.storage().instance().get(&Key::Project).unwrap();
        if bound != project {
            panic_with_error!(&env, Error::WrongProject);
        }
        if env.storage().persistent().has(&Key::Offer(offer.clone())) {
            panic_with_error!(&env, Error::DuplicateOffer);
        }
        let record = Offer {
            offer: offer.clone(),
            project: project.clone(),
            space,
            host: host.clone(),
            state: State::Available,
            holder: None,
            published_at: env.ledger().timestamp(),
            reserved_at: 0,
        };
        env.storage().persistent().set(&Key::Offer(offer.clone()), &record);
        Published { offer, project, host }.publish(&env);
        record
    }

    /// A brand reserves an AVAILABLE offer. The first holder wins; every later attempt,
    /// including a retry by the same account, fails and leaves the record unchanged.
    pub fn reserve(env: Env, offer: BytesN<32>, brand: Address) -> Offer {
        brand.require_auth();
        let mut record: Offer = env
            .storage()
            .persistent()
            .get(&Key::Offer(offer.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::UnknownOffer));
        if record.state != State::Available {
            panic_with_error!(&env, Error::AlreadyReserved);
        }
        record.state = State::Reserved;
        record.holder = Some(brand.clone());
        record.reserved_at = env.ledger().timestamp();
        env.storage().persistent().set(&Key::Offer(offer.clone()), &record);
        Reserved { offer, holder: brand }.publish(&env);
        record
    }

    /// Confirmed state for an offer id. Unknown ids return None, never availability.
    pub fn get(env: Env, offer: BytesN<32>) -> Option<Offer> {
        env.storage().persistent().get(&Key::Offer(offer))
    }

    pub fn project(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&Key::Project)
    }

    pub fn host(env: Env) -> Option<Address> {
        env.storage().instance().get(&Key::Host)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    fn id(env: &Env, n: u8) -> BytesN<32> {
        BytesN::from_array(env, &[n; 32])
    }

    fn setup(env: &Env) -> (ReservationClient<'_>, Address, BytesN<32>) {
        let host = Address::generate(env);
        let project = id(env, 1);
        let contract = env.register(Reservation, (project.clone(), host.clone()));
        (ReservationClient::new(env, &contract), host, project)
    }

    #[test]
    fn init_binds_project_and_host() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, host, project) = setup(&env);
        assert_eq!(client.project(), Some(project));
        assert_eq!(client.host(), Some(host));
    }

    #[test]
    fn publish_then_reserve_once() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, host, project) = setup(&env);
        let offer = id(&env, 7);
        let published = client.publish(&project, &offer, &id(&env, 9));
        assert_eq!(published.state, State::Available);
        assert_eq!(published.holder, None);
        assert_eq!(published.host, host);

        let brand = Address::generate(&env);
        let reserved = client.reserve(&offer, &brand);
        assert_eq!(reserved.state, State::Reserved);
        assert_eq!(reserved.holder, Some(brand.clone()));
        assert_eq!(client.get(&offer).unwrap().holder, Some(brand));
    }

    #[test]
    fn second_reservation_fails_and_keeps_first_holder() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, project) = setup(&env);
        let offer = id(&env, 7);
        client.publish(&project, &offer, &id(&env, 9));
        let first = Address::generate(&env);
        let second = Address::generate(&env);
        client.reserve(&offer, &first);
        assert_eq!(client.try_reserve(&offer, &second), Err(Ok(Error::AlreadyReserved)));
        assert_eq!(client.try_reserve(&offer, &first), Err(Ok(Error::AlreadyReserved)));
        assert_eq!(client.get(&offer).unwrap().holder, Some(first));
    }

    #[test]
    fn duplicate_offer_id_is_rejected_without_overwrite() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, project) = setup(&env);
        let offer = id(&env, 7);
        client.publish(&project, &offer, &id(&env, 9));
        assert_eq!(
            client.try_publish(&project, &offer, &id(&env, 10)),
            Err(Ok(Error::DuplicateOffer))
        );
        assert_eq!(client.get(&offer).unwrap().space, id(&env, 9));
    }

    #[test]
    fn wrong_project_and_unknown_offer_are_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);
        assert_eq!(
            client.try_publish(&id(&env, 2), &id(&env, 7), &id(&env, 9)),
            Err(Ok(Error::WrongProject))
        );
        assert_eq!(client.get(&id(&env, 42)), None);
        let brand = Address::generate(&env);
        assert_eq!(client.try_reserve(&id(&env, 42), &brand), Err(Ok(Error::UnknownOffer)));
    }

    #[test]
    fn only_the_bound_host_can_publish() {
        let env = Env::default();
        let host = Address::generate(&env);
        let intruder = Address::generate(&env);
        let project = id(&env, 1);
        env.mock_all_auths();
        let contract = env.register(Reservation, (project.clone(), host.clone()));
        let client = ReservationClient::new(&env, &contract);
        let offer = id(&env, 7);
        // From here on only the intruder authorizes; the host's require_auth must fail.
        env.mock_auths(&[MockAuth {
            address: &intruder,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "publish",
                args: (project.clone(), offer.clone(), id(&env, 9)).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_publish(&project, &offer, &id(&env, 9)).is_err());
        assert_eq!(client.get(&offer), None);
    }
}
