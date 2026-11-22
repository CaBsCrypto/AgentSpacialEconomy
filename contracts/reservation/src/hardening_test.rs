use super::*;
use soroban_sdk::{
    events::Event,
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    IntoVal, Map, Symbol, TryFromVal, Val,
};

fn id(env: &Env, value: u8) -> BytesN<32> {
    BytesN::from_array(env, &[value; 32])
}

fn setup(env: &Env) -> (Address, Address, BytesN<32>) {
    env.mock_all_auths();
    let host = Address::generate(env);
    let project = id(env, 1);
    let contract = env.register(Reservation, (project.clone(), host.clone()));
    (contract, host, project)
}

#[test]
fn an_intruder_cannot_initialize_again_or_change_the_bound_identity() {
    let env = Env::default();
    let (contract, host, project) = setup(&env);
    let intruder = Address::generate(&env);
    let attempted = env.try_invoke_contract::<(), soroban_sdk::Error>(
        &contract,
        &Symbol::new(&env, "__constructor"),
        (id(&env, 2), intruder).into_val(&env),
    );
    assert!(attempted.is_err());
    let client = ReservationClient::new(&env, &contract);
    assert_eq!(client.host(), Some(host));
    assert_eq!(client.project(), Some(project));
}

#[test]
fn reservation_requires_the_named_brand_and_preserves_available_on_auth_failure() {
    let env = Env::default();
    let (contract, _, project) = setup(&env);
    let client = ReservationClient::new(&env, &contract);
    let offer = id(&env, 7);
    let original = client.publish(&project, &offer, &id(&env, 9));
    let brand = Address::generate(&env);
    let intruder = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &intruder,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "reserve",
            args: (offer.clone(), brand.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_reserve(&offer, &brand).is_err());
    assert_eq!(client.get(&offer), Some(original.clone()));
    env.mock_auths(&[]);
    assert!(client.try_reserve(&offer, &brand).is_err());
    assert_eq!(client.get(&offer), Some(original));
    env.mock_auths(&[MockAuth {
        address: &brand,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "reserve",
            args: (offer.clone(), brand.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(client.reserve(&offer, &brand).holder, Some(brand));
}

#[test]
fn two_thousand_competitors_leave_exactly_one_holder_in_each_of_one_hundred_rounds() {
    for round in 0..100u8 {
        let env = Env::default();
        let (contract, _, project) = setup(&env);
        let client = ReservationClient::new(&env, &contract);
        let offer = id(&env, round);
        client.publish(&project, &offer, &id(&env, 9));
        let winner = Address::generate(&env);
        let mut successes = 0;
        for position in 0..20 {
            let contender = if position == 0 {
                winner.clone()
            } else {
                Address::generate(&env)
            };
            match client.try_reserve(&offer, &contender) {
                Ok(Ok(record)) => {
                    successes += 1;
                    assert_eq!(record.holder, Some(winner.clone()));
                }
                result => assert_eq!(
                    result,
                    Err(Ok(soroban_sdk::Error::from_contract_error(
                        Error::AlreadyReserved as u32
                    )))
                ),
            }
            let confirmed = client.get(&offer).unwrap();
            assert_eq!(confirmed.state, State::Reserved);
            assert_eq!(confirmed.holder, Some(winner.clone()));
        }
        assert_eq!(successes, 1);
        assert!(client.try_reserve(&offer, &winner).is_err());
    }
}

#[test]
fn successful_events_match_offer_holder_and_ledger_timestamps() {
    let env = Env::default();
    env.ledger().set_timestamp(100);
    let (contract, host, project) = setup(&env);
    let client = ReservationClient::new(&env, &contract);
    let offer = id(&env, 7);
    let published = client.publish(&project, &offer, &id(&env, 9));
    let event = Published {
        offer: offer.clone(),
        project: project.clone(),
        host: host.clone(),
    };
    let topics: Vec<Val> = (Symbol::new(&env, "published"), offer.clone()).into_val(&env);
    assert_eq!(event.topics(&env), topics);
    let data: Map<Symbol, Val> = soroban_sdk::map![
        &env,
        (Symbol::new(&env, "host"), host.clone().into_val(&env)),
        (Symbol::new(&env, "project"), project.into_val(&env))
    ];
    assert_eq!(
        Map::<Symbol, Val>::try_from_val(&env, &event.data(&env)).unwrap(),
        data
    );
    assert_eq!(
        env.events().all().events().last().unwrap(),
        &event.to_xdr(&env, &contract)
    );
    assert_eq!(published.published_at, 100);
    assert_eq!(published.reserved_at, 0);
    env.ledger().set_timestamp(200);
    let brand = Address::generate(&env);
    let reserved = client.reserve(&offer, &brand);
    let event = Reserved {
        offer: offer.clone(),
        holder: brand.clone(),
    };
    let topics: Vec<Val> = (Symbol::new(&env, "reserved"), offer.clone()).into_val(&env);
    assert_eq!(event.topics(&env), topics);
    let data: Map<Symbol, Val> =
        soroban_sdk::map![&env, (Symbol::new(&env, "holder"), brand.into_val(&env))];
    assert_eq!(
        Map::<Symbol, Val>::try_from_val(&env, &event.data(&env)).unwrap(),
        data
    );
    assert_eq!(
        env.events().all().events().last().unwrap(),
        &event.to_xdr(&env, &contract)
    );
    assert_eq!(reserved.published_at, 100);
    assert_eq!(reserved.reserved_at, 200);
    client.maintain(&soroban_sdk::vec![&env, offer]);
    let event = Maintained { count: 1, host };
    assert_eq!(
        env.events().all().events().last().unwrap(),
        &event.to_xdr(&env, &contract)
    );
}

#[test]
fn successful_reads_and_maintenance_extend_ttl_without_resetting_the_record() {
    let env = Env::default();
    env.ledger().set_sequence_number(100);
    let (contract, _, project) = setup(&env);
    let client = ReservationClient::new(&env, &contract);
    let offer = id(&env, 7);
    client.publish(&project, &offer, &id(&env, 9));
    let holder = Address::generate(&env);
    let reserved = client.reserve(&offer, &holder);
    env.as_contract(&contract, || {
        assert_eq!(env.storage().instance().get_ttl(), TTL_TARGET);
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&Key::Offer(offer.clone())),
            TTL_TARGET
        );
    });
    env.ledger()
        .set_sequence_number(100 + TTL_TARGET - TTL_THRESHOLD + 1);
    assert_eq!(client.get(&offer), Some(reserved.clone()));
    env.as_contract(&contract, || {
        assert_eq!(env.storage().instance().get_ttl(), TTL_TARGET);
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&Key::Offer(offer.clone())),
            TTL_TARGET
        );
    });
    env.ledger()
        .set_sequence_number(100 + 2 * (TTL_TARGET - TTL_THRESHOLD + 1));
    assert_eq!(client.maintain(&soroban_sdk::vec![&env, offer.clone()]), 1);
    env.as_contract(&contract, || {
        assert_eq!(env.storage().instance().get_ttl(), TTL_TARGET);
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&Key::Offer(offer.clone())),
            TTL_TARGET
        );
    });
    assert_eq!(client.get(&offer), Some(reserved));
}

#[test]
fn retention_is_clamped_to_the_network_limit() {
    let env = Env::default();
    env.ledger().set_min_persistent_entry_ttl(10);
    env.ledger().set_max_entry_ttl(1000);
    let (contract, _, project) = setup(&env);
    let client = ReservationClient::new(&env, &contract);
    let offer = id(&env, 7);
    client.publish(&project, &offer, &id(&env, 9));
    env.as_contract(&contract, || {
        let maximum = env.storage().max_ttl();
        assert_eq!(env.storage().instance().get_ttl(), maximum);
        assert_eq!(
            env.storage().persistent().get_ttl(&Key::Offer(offer)),
            maximum
        );
    });
}

#[test]
fn expired_persistent_record_restores_with_its_original_id_and_holder() {
    let env = Env::default();
    env.ledger().set_sequence_number(100);
    let (contract, host, project) = setup(&env);
    let client = ReservationClient::new(&env, &contract);
    let offer = id(&env, 7);
    client.publish(&project, &offer, &id(&env, 9));
    let holder = Address::generate(&env);
    let original = client.reserve(&offer, &holder);
    // The local recording host restores expired persistent entries on access.
    // Real-network restoration still requires the simulation's restore resources.
    env.ledger().set_sequence_number(100 + TTL_TARGET + 1);
    assert_eq!(client.get(&offer), Some(original.clone()));
    assert_eq!(client.host(), Some(host));
    assert_eq!(client.project(), Some(project.clone()));
    assert_eq!(
        client.try_publish(&project, &offer, &id(&env, 9)),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::DuplicateOffer as u32
        )))
    );
    assert_eq!(
        client.try_reserve(&offer, &Address::generate(&env)),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::AlreadyReserved as u32
        )))
    );
    assert_eq!(client.get(&offer), Some(original));
}

#[test]
fn maintenance_requires_host_and_rejects_unknown_duplicate_and_oversized_batches() {
    let env = Env::default();
    let (contract, _, project) = setup(&env);
    let client = ReservationClient::new(&env, &contract);
    let offer = id(&env, 7);
    let original = client.publish(&project, &offer, &id(&env, 9));
    env.mock_auths(&[]);
    assert!(client
        .try_maintain(&soroban_sdk::vec![&env, offer.clone()])
        .is_err());
    env.mock_all_auths();
    for (batch, error) in [
        (soroban_sdk::vec![&env, id(&env, 42)], Error::UnknownOffer),
        (
            soroban_sdk::vec![&env, offer.clone(), offer.clone()],
            Error::DuplicateMaintenanceOffer,
        ),
        (
            Vec::from_array(
                &env,
                core::array::from_fn::<_, 21, _>(|n| id(&env, n as u8)),
            ),
            Error::TooManyOffers,
        ),
    ] {
        assert_eq!(
            client.try_maintain(&batch),
            Err(Ok(soroban_sdk::Error::from_contract_error(error as u32)))
        );
    }
    assert_eq!(client.get(&offer), Some(original));
    assert_eq!(client.get(&id(&env, 42)), None);
    assert_eq!(client.maintain(&Vec::new(&env)), 0);
    let mut maximum = Vec::new(&env);
    for n in 50..70 {
        let next = id(&env, n);
        client.publish(&project, &next, &id(&env, 9));
        maximum.push_back(next);
    }
    assert_eq!(client.maintain(&maximum), 20);
}
