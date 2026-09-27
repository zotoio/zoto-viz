## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| row-demo-not-blank | tests/test_marble_run_pack.py :: test_marble_run_row_demo_not_blank | Revert marble-run production guard (row-demo-not-blank) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_demo_not_blank | RED (expected) |
| row-determinism | tests/test_marble_run_pack.py :: test_marble_run_row_determinism | Revert marble-run production guard (row-determinism) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_determinism | RED (expected) |
| row-fixed-timestep | tests/test_marble_run_pack.py :: test_marble_run_row_fixed_timestep | Revert marble-run production guard (row-fixed-timestep) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_fixed_timestep | RED (expected) |
| row-integrate-steps | tests/test_marble_run_pack.py :: test_marble_run_row_integrate_steps | Revert marble-run production guard (row-integrate-steps) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_integrate_steps | RED (expected) |
| row-jar-and-hue | tests/test_marble_run_pack.py :: test_marble_run_row_jar_and_hue | Revert marble-run production guard (row-jar-and-hue) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_jar_and_hue | RED (expected) |
| row-live-and-fail-glow | tests/test_marble_run_pack.py :: test_marble_run_row_live_and_fail_glow | Revert marble-run production guard (row-live-and-fail-glow) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_live_and_fail_glow | RED (expected) |
| row-pack-vitest | tests/test_marble_run_pack.py :: test_marble_run_pack_vitest | Revert marble-run production guard (row-pack-vitest) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_pack_vitest | RED (expected) |
| row-packet-cap | tests/test_marble_run_pack.py :: test_marble_run_row_packet_cap | Revert marble-run production guard (row-packet-cap) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_packet_cap | RED (expected) |
| row-slot-geometry | tests/test_marble_run_pack.py :: test_marble_run_row_slot_geometry | Revert marble-run production guard (row-slot-geometry) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_slot_geometry | RED (expected) |
| row-work-budget-presets | tests/test_marble_run_pack.py :: test_marble_run_row_work_budget_presets | Revert marble-run production guard (row-work-budget-presets) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_work_budget_presets | RED (expected) |
| row-yaml-and-sky | tests/test_marble_run_pack.py :: test_marble_run_row_yaml_and_sky | Revert marble-run production guard (row-yaml-and-sky) | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_marble_run_pack.py::test_marble_run_row_yaml_and_sky | RED (expected) |

### row-demo-not-blank

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
______________________ test_marble_run_row_demo_not_blank ______________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 11ms
E            ❯ marble-run shipped pack (10)
E              × demo frames never leave the board blank while marbles are in flight 10ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:23
E            Duration  383ms (environment 65%, transform 25%, tests 4%, import 3%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > demo frames never leave the board blank while marbles are in flight
E         AssertionError: expected 0 to be greater than 0
E          ❯ marble-run.test.ts:158:24
E             156|       }
E             157|     }
E             160|     const { slot0 } = packMarbleSlots(liveFrame({ t: 240 * SIM_DT, dem…
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E         
E       assert 1 == 0
E        +  where 1 = CompletedProcess(args=['pnpm', 'exec', 'vitest', 'run', '--config', '<tmp>   160|     const { slot0 } = packMarbleSlots(liveFrame({ t: 240 * SIM_DT, dem…\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯\n\n').returncode

tests/test_marble_run_pack.py:47: AssertionError
=========================== short test summary info ============================
FAILED tests/test_marble_run_pack.py::test_marble_run_row_demo_not_blank - As...
============================== 1 failed in 0.86s ===============================
```

### row-determinism

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
_______________________ test_marble_run_row_determinism ________________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 11ms
E            ❯ marble-run shipped pack (10)
E              × is deterministic for pinned seed and preset 10ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:26
E            Duration  388ms (environment 64%, transform 26%, tests 3%, import 3%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > is deterministic for pinned seed and preset
E         AssertionError: expected -122515420 to be -122515417 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - -122515417
E         + -122515420
E         
E          ❯ marble-run.test.ts:94:15
E              92|     const a = marbleDeterminismDigest(3.5, o);
E              93|     const b = marbleDeterminismDigest(3.5, o);
E              96|     expect(c).not.toBe(a);
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```

### row-fixed-timestep

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
______________________ test_marble_run_row_fixed_timestep ______________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 7ms
E            ❯ marble-run shipped pack (10)
E              × fixed timestep sim respects catch-up cap from work budget 6ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:30
E            Duration  387ms (environment 67%, transform 24%, import 3%, tests 2%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > fixed timestep sim respects catch-up cap from work budget
E         AssertionError: expected 8 to be 4 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - 4
E         + 8
E         
E          ❯ marble-run.test.ts:234:43
E             232|     const sim = new MarbleSim(parseMarbleOptions({ maxMarbles: "16" })…
E             233|     sim.stepFrame(0.5);
E             236|   });
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```

### row-integrate-steps

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
_____________________ test_marble_run_row_integrate_steps ______________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 7ms
E            ❯ marble-run shipped pack (10)
E              × 600-frame row: integrate runs exactly maxSimStepsPerFrame per frame on ingest path 6ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:33
E            Duration  382ms (environment 67%, transform 24%, import 3%, tests 2%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > 600-frame row: integrate runs exactly maxSimStepsPerFrame per frame on ingest path
E         AssertionError: expected 2 to be 1 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - 1
E         + 2
E         
E          ❯ marble-run.test.ts:103:51
E             101|     expect(marbleWorkBudget()).toEqual(CONSERVATIVE_WORK_BUDGET);
E             102|     ingestFrame(liveFrame({ dt: 0.25 }));
E             105|     const hostDelivers = clampManifestWorkBudgetToCeilings(
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```

### row-jar-and-hue

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
_______________________ test_marble_run_row_jar_and_hue ________________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 7ms
E            ❯ marble-run shipped pack (10)
E              × stable jar routing and protocol hue 6ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:36
E            Duration  384ms (environment 66%, transform 25%, import 3%, tests 2%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > stable jar routing and protocol hue
E         AssertionError: expected +0 to be 5 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - 5
E         + 0
E         
E          ❯ marble-run.test.ts:226:61
E             224|     setMarbleOptions(o);
E             225|     ingestFrame(liveFrame({ t: 0, demo: false, packets: [{ proto, size…
E             228|     expect(marbleHueForPacket(pkt)).toBe(hash01("tls"));
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```

### row-live-and-fail-glow

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
____________________ test_marble_run_row_live_and_fail_glow ____________________

    def test_marble_run_row_live_and_fail_glow() -> None:
>       _pack_vitest_filter("live packets spawn visible marbles")

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 7ms
E            ❯ marble-run shipped pack (10)
E              × live packets spawn visible marbles; failure path lights reject glow 6ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:40
E            Duration  379ms (environment 65%, transform 26%, import 3%, tests 2%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > live packets spawn visible marbles; failure path lights reject glow
E         AssertionError: expected +0 to be 2 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - 2
E         + 0
E         
E          ❯ marble-run.test.ts:194:65
E             192|       ],
E             193|     }));
E             196|     disposeMarblePack();
E
```

### row-pack-vitest

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
_________________________ test_marble_run_pack_vitest __________________________

    def test_marble_run_pack_vitest() -> None:
        assert PACK_TEST.is_file()
        _ensure_web_vitest()
        web = ROOT / "web"
            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed) 51ms
E            ❯ marble-run shipped pack (10)
E              × caps live packets at maxPacketsPerFrame with exact consumed and HUD skip counts 5ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 passed (10)
E            Start at  15:02:43
E            Duration  418ms (environment 58%, transform 22%, tests 15%, import 3%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > caps live packets at maxPacketsPerFrame with exact consumed and HUD skip counts
E         AssertionError: expected 48 to be 8 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - 8
E         + 48
E         
E          ❯ marble-run.test.ts:134:49
E             132|     }));
E             133|     ingestFrame(liveFrame({ t: 0, dt: 0, demo: false, packets }));
E             136|     expect(marbleSim().bodies().filter((m) => m.active).length).toBe(8…
```

### row-packet-cap

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
________________________ test_marble_run_row_packet_cap ________________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 8ms
E            ❯ marble-run shipped pack (10)
E              × caps live packets at maxPacketsPerFrame with exact consumed and HUD skip counts 7ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:46
E            Duration  393ms (environment 66%, transform 26%, import 3%, tests 3%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > caps live packets at maxPacketsPerFrame with exact consumed and HUD skip counts
E         AssertionError: expected 48 to be 8 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - 8
E         + 48
E         
E          ❯ marble-run.test.ts:134:49
E             132|     }));
E             133|     ingestFrame(liveFrame({ t: 0, dt: 0, demo: false, packets }));
E             136|     expect(marbleSim().bodies().filter((m) => m.active).length).toBe(8…
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```

### row-slot-geometry

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
______________________ test_marble_run_row_slot_geometry _______________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 7ms
E            ❯ marble-run shipped pack (10)
E              × packs slot geometry contract 6ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:49
E            Duration  385ms (environment 65%, transform 26%, import 3%, tests 2%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > packs slot geometry contract
E         AssertionError: expected 63 to be 64 // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - 64
E         + 63
E         
E          ❯ marble-run.test.ts:241:26
E             239|     setMarbleOptions(MARBLE_DEFAULTS);
E             240|     const { slot0, slot1 } = packMarbleSlots(liveFrame({ t: 0, demo: t…
E             243|   });
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```

### row-work-budget-presets

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
___________________ test_marble_run_row_work_budget_presets ____________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 11ms
E            ❯ marble-run shipped pack (10)
E              × keeps work counts under caps for every preset at pinned seed 10ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:53
E            Duration  390ms (environment 65%, transform 25%, tests 4%, import 3%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > keeps work counts under caps for every preset at pinned seed
E         AssertionError: expected false to be true // Object.is equality
E         
E         - Expected
E         + Received
E         
E         - true
E         + false
E         
E          ❯ marble-run.test.ts:179:35
E             177|         }));
E             178|       }
E             181|     }
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```

### row-yaml-and-sky

```
tests/test_marble_run_pack.py F                                          [100%]

=================================== FAILURES ===================================
_______________________ test_marble_run_row_yaml_and_sky _______________________

            check=False,
        )
>       assert proc.returncode == 0, proc.stdout + proc.stderr
E       AssertionError: 
E          RUN  v5.0.0 <tmp>
E         
E          ❯ marble-run.test.ts (10 tests | 1 failed | 9 skipped) 8ms
E            ❯ marble-run shipped pack (10)
E              × declares mapping, work budget in yaml, and compiles sky 7ms
E         
E          Test Files  1 failed (1)
E               Tests  1 failed | 9 skipped (10)
E            Start at  15:02:56
E            Duration  383ms (environment 64%, transform 27%, import 4%, tests 3%, setup 2%, worker 1%)
E         
E         
E         ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
E         
E          FAIL  marble-run.test.ts > marble-run shipped pack > declares mapping, work budget in yaml, and compiles sky
E         AssertionError: expected { maxDrawCalls: 64, …(5) } to deeply equal { maxDrawCalls: 64, …(5) }
E         
E         - Expected
E         + Received
E         
E           {
E           }
E         
E          ❯ marble-run.test.ts:79:22
E              77|     expect(MARBLE_DATA_MAPPING.length).toBe(4);
E              78|     const fromYaml = parseMarbleWorkBudgetYaml(VIS);
E              81|     const blob = `${PLUGIN}\n${VIS}\n${FRAG}`.toLowerCase();
E         
E         ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
E         
E
```
