#![cfg(feature = "wasm-tests")]

use reservation::{ReservationClient, State};
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, BytesN, Env, IntoVal, Symbol,
};

// This factory invokes the real deployment host function with built WASM. Unlike
// Env::register(Reservation, ...), it does not silently mock constructor auth.
#[contract]
struct Factory;
#[contractimpl]
impl Factory {
    pub fn deploy(
        env: Env,
        wasm: BytesN<32>,
        project: BytesN<32>,
        host: Address,
        salt: BytesN<32>,
    ) -> Address {
        env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm, (project, host))
    }
}

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn wasm_constructor_and_brand_auth_are_enforced_by_the_host() {
    let bytes = std::fs::read(
        std::env::var("RESERVATION_TEST_WASM").expect("build WASM and set RESERVATION_TEST_WASM"),
    )
    .expect("read built WASM");
    let env = Env::default();
    let factory = env.register(Factory, ());
    let builder = FactoryClient::new(&env, &factory);
    let wasm = env.deployer().upload_contract_wasm(bytes.as_slice());
    let host = Address::generate(&env);
    let project = id(&env, 1);
    let salt = id(&env, 2);
    // No auth at all: the deployment cannot bind someone else's host address.
    assert!(builder.try_deploy(&wasm, &project, &host, &salt).is_err());
    // The host address authorizes the nested constructor, not the factory.
    // Missing authorization above is still executed in enforcing mode.
    env.mock_all_auths_allowing_non_root_auth();
    let contract = builder.deploy(&wasm, &project, &host, &salt);
    env.mock_all_auths();
    let client = ReservationClient::new(&env, &contract);
    assert_eq!(client.host(), Some(host.clone()));
    assert_eq!(client.project(), Some(project.clone()));
    // The failed attempt did not create an instance; the successful one cannot
    // subsequently be redeployed or initialized under an intruder's identity.
    let intruder = Address::generate(&env);
    assert!(builder
        .try_deploy(&wasm, &id(&env, 3), &intruder, &salt)
        .is_err());
    assert!(env
        .try_invoke_contract::<(), soroban_sdk::Error>(
            &contract,
            &Symbol::new(&env, "__constructor"),
            (id(&env, 3), intruder).into_val(&env)
        )
        .is_err());
    assert_eq!(client.host(), Some(host));
    assert_eq!(client.project(), Some(project.clone()));

    let offer = id(&env, 7);
    env.mock_auths(&[]);
    assert!(client.try_publish(&project, &offer, &id(&env, 9)).is_err());
    assert_eq!(client.get(&offer), None);
    env.mock_all_auths();
    client.publish(&project, &offer, &id(&env, 9));
    let brand = Address::generate(&env);
    env.mock_auths(&[]);
    assert!(client.try_reserve(&offer, &brand).is_err());
    assert_eq!(client.get(&offer).unwrap().state, State::Available);
    env.mock_all_auths();
    let final_record = client.reserve(&offer, &brand);
    assert_eq!(final_record.holder, Some(brand.clone()));
    assert!(client.try_reserve(&offer, &brand).is_err());
    client.maintain(&soroban_sdk::vec![&env, offer.clone()]);
    assert_eq!(client.get(&offer), Some(final_record));
}

#[test]
fn host_created_bootstrap_binds_creation_and_constructor_in_one_auth_tree() {
    use soroban_sdk::testutils::AuthorizedFunction;
    let bytes = std::fs::read(std::env::var("RESERVATION_TEST_WASM").unwrap()).unwrap();
    let env = Env::default();
    let wasm = env.deployer().upload_contract_wasm(bytes.as_slice());
    let host = Address::generate(&env);
    let project = id(&env, 1);
    let salt = id(&env, 2);
    env.mock_all_auths();
    let contract = env
        .deployer()
        .with_address(host.clone(), salt)
        .deploy_v2(wasm, (project.clone(), host.clone()));
    let auth = env.auths();
    assert_eq!(auth.len(), 1);
    assert_eq!(auth[0].0, host);
    assert!(matches!(
        &auth[0].1.function,
        AuthorizedFunction::CreateContractV2HostFn(_)
    ));
    assert_eq!(auth[0].1.sub_invocations.len(), 1);
    let constructor = &auth[0].1.sub_invocations[0];
    assert_eq!(
        constructor.function,
        AuthorizedFunction::Contract((
            contract,
            Symbol::new(&env, "__constructor"),
            (project, host).into_val(&env)
        ))
    );
    assert!(constructor.sub_invocations.is_empty());
}
