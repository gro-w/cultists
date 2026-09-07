# Legacy → ng migration inventory

Generated: 2026-09-07T02:29:58.887Z

This report is evidence for migration planning. It does not claim runtime parity.

## Corpus summary

- Legacy JSON files: **54**
- ng JSON files: **185**
- Legacy blueprints: **168**
- ng blueprints: **212**
- Legacy top-level IDs: **1052**
- ng top-level IDs: **48818**

## Legacy JSON files without same relative filename in ng

- `achievements.json`
- `app_his_custom.json`
- `applist.json`
- `bgm.json`
- `calendar.json`
- `cg.json`
- `chatgtp_daily_import.json`
- `chatgtp_qa.json`
- `diagnoses.json`
- `endings.json`
- `global_variables.json`
- `item_placements.json`
- `items.json`
- `keywords.json`
- `locations.json`
- `maininit.json`
- `mainpub.json`
- `medicines.json`
- `npcs.json`
- `skills.json`
- `social_apps.json`
- `social01a.json`
- `social01b.json`
- `social02a.json`
- `social02b.json`
- `social03a.json`
- `social03b.json`
- `social04a.json`
- `social04b.json`
- `social05a.json`
- `social05b.json`
- `social06a.json`
- `social06b.json`
- `social07a.json`
- `social07b.json`
- `socialpub.json`
- `special_events.json`
- `time_rules.json`
- `turtle_soups.json`
- `work01a.json`
- `work01b.json`
- `work02a.json`
- `work02b.json`
- `work03a.json`
- `work03b.json`
- `work04a.json`
- `work04b.json`
- `work05a.json`
- `work05b.json`
- `work06a.json`
- `work06b.json`
- `work07a.json`
- `work07b.json`
- `workpub.json`

## Node-type inventory

| Node type | Legacy occurrences | ng occurrences |
| --- | ---: | ---: |
| `activityEnd` | 172 | 217 |
| `activityExpiry` | 167 | 117 |
| `applyPublicVariableEffect` | 0 | 54 |
| `arithmetic` | 34 | 60 |
| `blockUntil` | 0 | 1 |
| `branch` | 19 | 22 |
| `choice` | 89 | 98 |
| `conditionalValue` | 0 | 11 |
| `consumeTime` | 466 | 501 |
| `createRecord` | 0 | 4 |
| `diceCheck` | 4 | 2 |
| `emitEvent` | 0 | 74 |
| `endCg` | 1 | 0 |
| `ending` | 6 | 6 |
| `findRecords` | 0 | 12 |
| `flowStart` | 168 | 212 |
| `getActivityInstanceCount` | 8 | 8 |
| `getGameTime` | 8 | 8 |
| `getGlobal` | 56 | 0 |
| `getProperty` | 0 | 11 |
| `getPublicVariable` | 0 | 34 |
| `getRecord` | 0 | 13 |
| `getVariable` | 0 | 7 |
| `hisRefresh` | 2 | 0 |
| `hisRenderDiagnosis` | 2 | 0 |
| `hisRenderPrescription` | 1 | 0 |
| `hisSelectPatient` | 1 | 0 |
| `hisSubmit` | 1 | 0 |
| `insertActivity` | 8 | 8 |
| `inventoryOperation` | 6 | 0 |
| `markOnboardingMilestone` | 0 | 6 |
| `openWindow` | 0 | 44 |
| `prerequisite` | 167 | 117 |
| `publicVariableCondition` | 0 | 2 |
| `randomBranch` | 2 | 2 |
| `runActivity` | 0 | 38 |
| `segmentBranch` | 21 | 0 |
| `setGlobal` | 64 | 0 |
| `setVariable` | 0 | 71 |
| `showCg` | 33 | 0 |
| `showImage` | 14 | 0 |
| `spellCast` | 3 | 0 |
| `spellEffect` | 2 | 0 |
| `statOperation` | 8 | 5 |
| `text` | 1285 | 1161 |
| `updateRecord` | 0 | 3 |

## Stable-ID differences

### Legacy IDs absent from ng

- Count: **37**
- `book_blue_love`
- `book_coc7`
- `book_innsmouth`
- `book_moon`
- `book_nahan`
- `book_wangxb`
- `diagnosis-category`
- `diagnosis-panel`
- `dialogue`
- `extra_workload`
- `feast_set`
- `frozen_meat`
- `hotpot`
- `ketchup`
- `locked_box`
- `medical-incidents`
- `medicine-1`
- `menu`
- `mystery_potion`
- `necklace_ajie`
- `necklace_awei`
- `necklace_binbin`
- `old_key`
- `opened_box`
- `pasta`
- `patient-list`
- `perfume`
- `physician_cert`
- `poster_jesus`
- `prescription`
- `salt_bag`
- `sandwich`
- `statue_ajie`
- `statue_awei`
- `statue_binbin`
- `submit`
- `swastika`

### ng IDs absent from legacy

- Count: **47803**
- `1000`
- `1001`
- `achievement`
- `achievementCategory`
- `achievement__all_texts_read`
- `achievement__developer_mode`
- `achievement__ending_any`
- `achievement__exam_pass`
- `achievement__fav_all_positive`
- `achievement__fav_cumulative_down`
- `achievement__fav_cumulative_up`
- `achievement__fav_first_down`
- `achievement__fav_first_up`
- `achievement__fav_maxed`
- `achievement__fav_three_high`
- `achievement__fav_zeroed`
- `achievement__san_fast_drop`
- `achievement__san_recovery`
- `achievement__san_steady`
- `achievement__san_zero`
- `achievement__skillcheck_critical_failure`
- `achievement__skillcheck_cumulative_success`
- `achievement__skillcheck_first_failure`
- `achievement__skillcheck_first_success`
- `achievement__study_believer`
- `…`
- `ulcerative_colitis`
- `urinary_incontinence`
- `urinary_tract_infection`
- `urticaria`
- `use-item`
- `varicose_veins`
- `vertigo`
- `vitamin_b12_deficiency_anemia`
- `vitamin_d_deficiency`
- `vitiligo`
- `welcome`
- `work01a-patient1`
- `work01a-patient1-start`
- `work01a-patient2`
- `work01a-patient2-start`
- `work01a-patient3`
- `work01a-patient3-start`
- `work01a-patient4`
- `work01a-patient4-start`
- `work01a-patient5`
- `work01a-patient5-start`
- `work01a-patient6`
- `work01a-patient6-start`
- `work01a-patient7`
- `work01a-patient7-start`

## Runtime/editor entry-point inventory

- Legacy data loaders: `js/apps/ChatGTPApp.js`, `js/apps/CustomWindowApp.js`, `js/apps/HISApp.js`, `js/apps/SocialMediaApp.js`, `js/core/AchievementManager.js`, `js/core/ActivityData.js`, `js/core/BgmManager.js`, `js/core/CalendarData.js`, `js/core/CGManager.js`, `js/core/DataLoader.js`, `js/core/EndingManager.js`, `js/core/FavorabilityManager.js`, `js/core/GlobalVariableManager.js`, `js/core/I18n.js`, `js/core/ItemManager.js`, `js/core/ItemPlacementManager.js`, `js/core/KeywordManager.js`, `js/core/LocationSystem.js`, `js/core/MedicalCaseManager.js`, `js/core/NpcStateManager.js`, `js/core/SkillManager.js`, `js/core/SpecialEventManager.js`, `js/core/TimeService.js`, `js/core/TurtleSoupManager.js`, `js/desktop/DevBgmEditorTab.js`, `js/desktop/DevCGEditorTab.js`, `js/desktop/DevDedicatedDataEditors.js`, `js/desktop/DevDialogueEditorTab.js`, `js/desktop/DevDormComputerTab.js`, `js/desktop/DeveloperMode.js`, `js/desktop/DevItemEditorTab.js`, `js/desktop/DevLocationEditorTab.js`, `js/desktop/DevTurtleSoupEditorTab.js`, `js/desktop/DormMode.js`, `js/desktop/EndingScreen.js`
- ng data loading: `ng/core/ActivityDefinitionStore.js`, `ng/core/DataStore.js`, `ng/core/WindowDefinitionStore.js`, `ng/dev/devApi.js`, `ng/engine.js`
- Legacy developer editors: `js/core/CGManager.js`, `js/core/DataLoader.js`, `js/core/DeveloperConfig.js`, `js/desktop/DevBgmEditorTab.js`, `js/desktop/DevCGEditorTab.js`, `js/desktop/DevCustomWindowEditor.js`, `js/desktop/DevDialogueEditorTab.js`, `js/desktop/DevDormComputerTab.js`, `js/desktop/DeveloperMode.js`, `js/desktop/DevItemEditorTab.js`, `js/desktop/DevLocationEditorTab.js`, `js/desktop/DevTurtleSoupEditorTab.js`, `js/main.js`
- ng developer tools: `ng/dev/ActivityDebuggerView.js`, `ng/dev/ActivityEditorModel.js`, `ng/dev/ActivityEditorView.js`, `ng/dev/ActivityListManagerModel.js`, `ng/dev/ActivityListManagerView.js`, `ng/dev/DatabaseDebuggerView.js`, `ng/dev/DataStructureEditorView.js`, `ng/dev/DesktopIconEditorView.js`, `ng/dev/devApi.js`, `ng/dev/DeveloperMode.js`, `ng/dev/OnboardingEditorView.js`, `ng/dev/PublicVariableDebuggerView.js`, `ng/dev/PublicVariableEditorView.js`, `ng/dev/WindowDefinitionManagerView.js`, `ng/dev/WindowEditorModel.js`, `ng/dev/WindowEditorView.js`, `ng/engine.js`, `ng/style.css`

## File-level details

| Tree | File | Top-level shape | Count | Blueprints | Bytes |
| --- | --- | --- | ---: | ---: | ---: |
| legacy | `achievements.json` | object | 2 | 0 | 10120 |
| legacy | `app_his_custom.json` | object | 11 | 5 | 6687 |
| legacy | `applist.json` | array | 1 | 0 | 127 |
| legacy | `bgm.json` | object | 3 | 0 | 5163 |
| legacy | `calendar.json` | object | 3 | 0 | 64 |
| legacy | `cg.json` | object | 1 | 0 | 4234 |
| legacy | `chatgtp_daily_import.json` | array | 6 | 0 | 134895 |
| legacy | `chatgtp_qa.json` | object | 4 | 0 | 20585345 |
| legacy | `diagnoses.json` | object | 2 | 0 | 62178 |
| legacy | `endings.json` | object | 1 | 15 | 193149 |
| legacy | `global_variables.json` | array | 111 | 0 | 10236 |
| legacy | `item_placements.json` | object | 1 | 0 | 446 |
| legacy | `items.json` | object | 1 | 57 | 269086 |
| legacy | `keywords.json` | object | 1 | 0 | 57092 |
| legacy | `locations.json` | object | 1 | 0 | 1861 |
| legacy | `maininit.json` | object | 1 | 0 | 20 |
| legacy | `mainpub.json` | object | 1 | 0 | 20 |
| legacy | `medicines.json` | object | 2 | 0 | 74139 |
| legacy | `npcs.json` | object | 1 | 0 | 3018 |
| legacy | `skills.json` | object | 1 | 0 | 230 |
| legacy | `social_apps.json` | object | 2 | 0 | 139827 |
| legacy | `social01a.json` | object | 2 | 0 | 61 |
| legacy | `social01b.json` | object | 2 | 2 | 45438 |
| legacy | `social02a.json` | object | 2 | 2 | 23936 |
| legacy | `social02b.json` | object | 1 | 1 | 4284 |
| legacy | `social03a.json` | object | 2 | 0 | 61 |
| legacy | `social03b.json` | object | 2 | 4 | 94171 |
| legacy | `social04a.json` | object | 2 | 2 | 24443 |
| legacy | `social04b.json` | object | 1 | 1 | 4263 |
| legacy | `social05a.json` | object | 2 | 1 | 15407 |
| legacy | `social05b.json` | object | 2 | 4 | 47276 |
| legacy | `social06a.json` | object | 2 | 2 | 14871 |
| legacy | `social06b.json` | object | 2 | 0 | 61 |
| legacy | `social07a.json` | object | 2 | 0 | 61 |
| legacy | `social07b.json` | object | 2 | 0 | 61 |
| legacy | `socialpub.json` | object | 1 | 4 | 85621 |
| legacy | `special_events.json` | object | 1 | 9 | 91253 |
| legacy | `time_rules.json` | object | 7 | 0 | 234 |
| legacy | `turtle_soups.json` | object | 1 | 0 | 9458 |
| legacy | `work01a.json` | object | 1 | 7 | 59128 |
| legacy | `work01b.json` | object | 1 | 0 | 20 |
| legacy | `work02a.json` | object | 1 | 8 | 63056 |
| legacy | `work02b.json` | object | 1 | 0 | 20 |
| legacy | `work03a.json` | object | 1 | 9 | 70962 |
| legacy | `work03b.json` | object | 1 | 0 | 20 |
| legacy | `work04a.json` | object | 1 | 7 | 55257 |
| legacy | `work04b.json` | object | 1 | 0 | 20 |
| legacy | `work05a.json` | object | 1 | 0 | 20 |
| legacy | `work05b.json` | object | 1 | 0 | 20 |
| legacy | `work06a.json` | object | 1 | 9 | 70963 |
| legacy | `work06b.json` | object | 1 | 0 | 20 |
| legacy | `work07a.json` | object | 1 | 8 | 63136 |
| legacy | `work07b.json` | object | 1 | 9 | 70960 |
| legacy | `workpub.json` | object | 1 | 2 | 40893 |
| ng | `activities/achievement__all_texts_read.json` | object | 5 | 1 | 1032 |
| ng | `activities/achievement__developer_mode.json` | object | 5 | 1 | 1038 |
| ng | `activities/achievement__ending_any.json` | object | 5 | 1 | 1023 |
| ng | `activities/achievement__exam_pass.json` | object | 5 | 1 | 1017 |
| ng | `activities/achievement__fav_all_positive.json` | object | 5 | 1 | 1038 |
| ng | `activities/achievement__fav_cumulative_down.json` | object | 5 | 1 | 1047 |
| ng | `activities/achievement__fav_cumulative_up.json` | object | 5 | 1 | 1044 |
| ng | `activities/achievement__fav_first_down.json` | object | 5 | 1 | 1032 |
| ng | `activities/achievement__fav_first_up.json` | object | 5 | 1 | 1026 |
| ng | `activities/achievement__fav_maxed.json` | object | 5 | 1 | 1017 |
| ng | `activities/achievement__fav_three_high.json` | object | 5 | 1 | 1041 |
| ng | `activities/achievement__fav_zeroed.json` | object | 5 | 1 | 1020 |
| ng | `activities/achievement__san_fast_drop.json` | object | 5 | 1 | 1029 |
| ng | `activities/achievement__san_recovery.json` | object | 5 | 1 | 1026 |
| ng | `activities/achievement__san_steady.json` | object | 5 | 1 | 1020 |
| ng | `activities/achievement__san_zero.json` | object | 5 | 1 | 1017 |
| ng | `activities/achievement__skillcheck_critical_failure.json` | object | 5 | 1 | 1071 |
| ng | `activities/achievement__skillcheck_cumulative_success.json` | object | 5 | 1 | 1074 |
| ng | `activities/achievement__skillcheck_first_failure.json` | object | 5 | 1 | 1062 |
| ng | `activities/achievement__skillcheck_first_success.json` | object | 5 | 1 | 1062 |
| ng | `activities/achievement__study_believer.json` | object | 5 | 1 | 1032 |
| ng | `activities/achievement__study_first.json` | object | 5 | 1 | 1023 |
| ng | `activities/achievement__study_king.json` | object | 5 | 1 | 1020 |
| ng | `activities/achievement__tabletop_first.json` | object | 5 | 1 | 1032 |
| ng | `activities/achievement__tabletop_skip.json` | object | 5 | 1 | 1029 |
| ng | `activities/achievement__tabletop_veteran.json` | object | 5 | 1 | 1040 |
| ng | `activities/default.json` | object | 3 | 1 | 998 |
| ng | `activities/dorm_activity_day1.json` | object | 5 | 1 | 19149 |
| ng | `activities/dorm_activity_day2.json` | object | 5 | 1 | 18381 |
| ng | `activities/dorm_activity_day3.json` | object | 5 | 1 | 22082 |
| ng | `activities/dorm_activity_day4.json` | object | 5 | 1 | 15797 |
| ng | `activities/dorm_activity_day5.json` | object | 5 | 1 | 14042 |
| ng | `activities/ending__cn01.json` | object | 4 | 1 | 18191 |
| ng | `activities/ending__cn02.json` | object | 4 | 1 | 1498 |
| ng | `activities/ending__cn03.json` | object | 4 | 1 | 10191 |
| ng | `activities/ending__cn04.json` | object | 4 | 1 | 12254 |
| ng | `activities/ending__cn05.json` | object | 4 | 1 | 7601 |
| ng | `activities/ending__cn06.json` | object | 4 | 1 | 18464 |
| ng | `activities/ending__cn07.json` | object | 4 | 1 | 4964 |
| ng | `activities/ending__cn08.json` | object | 4 | 1 | 11245 |
| ng | `activities/ending__cn09.json` | object | 4 | 1 | 9651 |
| ng | `activities/ending__cn10.json` | object | 4 | 1 | 20945 |
| ng | `activities/ending__cn11.json` | object | 4 | 1 | 32213 |
| ng | `activities/ending__cn12.json` | object | 4 | 1 | 19355 |
| ng | `activities/ending__cn13.json` | object | 4 | 1 | 1516 |
| ng | `activities/ending__cn14.json` | object | 4 | 1 | 1498 |
| ng | `activities/ending__cn15.json` | object | 4 | 1 | 10170 |
| ng | `activities/event__binbin_turtle_fail.json` | object | 4 | 1 | 1445 |
| ng | `activities/event__binbin_turtle_success.json` | object | 4 | 1 | 1828 |
| ng | `activities/event__cn01.json` | object | 4 | 1 | 1445 |
| ng | `activities/event__cn02.json` | object | 4 | 1 | 7118 |
| ng | `activities/event__cn03.json` | object | 4 | 1 | 3123 |
| ng | `activities/event__cn04.json` | object | 4 | 1 | 4861 |
| ng | `activities/event__cn05.json` | object | 4 | 1 | 23514 |
| ng | `activities/event__cn06.json` | object | 4 | 1 | 1450 |
| ng | `activities/event__cn07.json` | object | 4 | 1 | 46345 |
| ng | `activities/his__his-filter-diagnosis.json` | object | 4 | 1 | 1266 |
| ng | `activities/his__his-initialize.json` | object | 4 | 1 | 1287 |
| ng | `activities/his__his-search.json` | object | 4 | 1 | 1242 |
| ng | `activities/his__his-select-patient.json` | object | 4 | 1 | 1975 |
| ng | `activities/his__his-submit.json` | object | 4 | 1 | 1515 |
| ng | `activities/medical_complaint_work.json` | object | 5 | 1 | 18573 |
| ng | `activities/medical_riot_work.json` | object | 5 | 1 | 19012 |
| ng | `activities/medical-appointment-watcher.json` | object | 3 | 1 | 4435 |
| ng | `activities/off-duty-open.json` | object | 3 | 1 | 954 |
| ng | `activities/patient_01_02_kidney_stone.json` | object | 5 | 1 | 6916 |
| ng | `activities/patient_01_03_benign_prostatic_hyperplasia.json` | object | 5 | 1 | 6964 |
| ng | `activities/patient_01_04_nausea_vomiting.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_01_05_lymphadenopathy.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_01_06_orthostatic_hypotension.json` | object | 5 | 1 | 6949 |
| ng | `activities/patient_01_07_closed_foot_fracture.json` | object | 5 | 1 | 6940 |
| ng | `activities/patient_02_01_gingivitis.json` | object | 5 | 1 | 6910 |
| ng | `activities/patient_02_02_plantar_fasciitis.json` | object | 5 | 1 | 6931 |
| ng | `activities/patient_02_03_hyperthyroidism.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_02_04_hypothyroidism.json` | object | 5 | 1 | 6922 |
| ng | `activities/patient_02_05_vitamin_b12_deficiency_anemia.json` | object | 5 | 1 | 6967 |
| ng | `activities/patient_02_06_iron_deficiency_anemia.json` | object | 5 | 1 | 6946 |
| ng | `activities/patient_02_07_dry_eye.json` | object | 5 | 1 | 6901 |
| ng | `activities/patient_03_01_bacterial_conjunctivitis.json` | object | 5 | 1 | 6952 |
| ng | `activities/patient_03_02_ulcerative_colitis.json` | object | 5 | 1 | 6934 |
| ng | `activities/patient_03_03_hemorrhoids.json` | object | 5 | 1 | 6913 |
| ng | `activities/patient_03_04_kidney_stone.json` | object | 5 | 1 | 6916 |
| ng | `activities/patient_03_05_benign_prostatic_hyperplasia.json` | object | 5 | 1 | 6964 |
| ng | `activities/patient_03_06_nausea_vomiting.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_03_07_lymphadenopathy.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_04_01_orthostatic_hypotension.json` | object | 5 | 1 | 6949 |
| ng | `activities/patient_04_02_closed_foot_fracture.json` | object | 5 | 1 | 6940 |
| ng | `activities/patient_04_03_gingivitis.json` | object | 5 | 1 | 6910 |
| ng | `activities/patient_04_04_plantar_fasciitis.json` | object | 5 | 1 | 6931 |
| ng | `activities/patient_04_05_hyperthyroidism.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_04_06_hypothyroidism.json` | object | 5 | 1 | 6922 |
| ng | `activities/patient_04_07_vitamin_b12_deficiency_anemia.json` | object | 5 | 1 | 6967 |
| ng | `activities/patient_06_01_nausea_vomiting.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_06_02_lymphadenopathy.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_06_03_orthostatic_hypotension.json` | object | 5 | 1 | 6949 |
| ng | `activities/patient_06_04_closed_foot_fracture.json` | object | 5 | 1 | 6940 |
| ng | `activities/patient_06_05_gingivitis.json` | object | 5 | 1 | 6910 |
| ng | `activities/patient_06_06_plantar_fasciitis.json` | object | 5 | 1 | 6931 |
| ng | `activities/patient_06_07_hyperthyroidism.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_07_01_hypothyroidism.json` | object | 5 | 1 | 6922 |
| ng | `activities/patient_07_02_vitamin_b12_deficiency_anemia.json` | object | 5 | 1 | 6967 |
| ng | `activities/patient_07_03_iron_deficiency_anemia.json` | object | 5 | 1 | 6946 |
| ng | `activities/patient_07_04_dry_eye.json` | object | 5 | 1 | 6901 |
| ng | `activities/patient_07_05_bacterial_conjunctivitis.json` | object | 5 | 1 | 6952 |
| ng | `activities/patient_07_06_ulcerative_colitis.json` | object | 5 | 1 | 6934 |
| ng | `activities/patient_07_07_hemorrhoids.json` | object | 5 | 1 | 6913 |
| ng | `activities/patient_08_01_kidney_stone.json` | object | 5 | 1 | 6916 |
| ng | `activities/patient_08_02_benign_prostatic_hyperplasia.json` | object | 5 | 1 | 6964 |
| ng | `activities/patient_08_03_nausea_vomiting.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_08_04_lymphadenopathy.json` | object | 5 | 1 | 6925 |
| ng | `activities/patient_08_05_orthostatic_hypotension.json` | object | 5 | 1 | 6949 |
| ng | `activities/patient_08_06_closed_foot_fracture.json` | object | 5 | 1 | 6940 |
| ng | `activities/patient_08_07_gingivitis.json` | object | 5 | 1 | 6910 |
| ng | `activities/patient_extra_02_a_08.json` | object | 5 | 1 | 6901 |
| ng | `activities/patient_extra_03_a_08.json` | object | 5 | 1 | 6909 |
| ng | `activities/patient_extra_03_a_09.json` | object | 5 | 1 | 6909 |
| ng | `activities/patient_extra_06_a_08.json` | object | 5 | 1 | 6909 |
| ng | `activities/patient_extra_06_a_09.json` | object | 5 | 1 | 6909 |
| ng | `activities/patient_extra_07_a_08.json` | object | 5 | 1 | 6905 |
| ng | `activities/patient_extra_07_b_08.json` | object | 5 | 1 | 6904 |
| ng | `activities/patient_extra_07_b_09.json` | object | 5 | 1 | 6904 |
| ng | `activities/patient_lin_ruoqing_01.json` | object | 5 | 1 | 10509 |
| ng | `activities/social01b_ajie_honor_of_kings.json` | object | 5 | 1 | 22953 |
| ng | `activities/social01b_awei_headphones.json` | object | 5 | 1 | 17628 |
| ng | `activities/social02a_ajie_chat.json` | object | 5 | 1 | 9876 |
| ng | `activities/social02a_awei_chat.json` | object | 5 | 1 | 10749 |
| ng | `activities/social02b_dorm_invite.json` | object | 5 | 1 | 3544 |
| ng | `activities/social03b_ajie_24_personality_high.json` | object | 5 | 1 | 22365 |
| ng | `activities/social03b_ajie_24_personality_low.json` | object | 5 | 1 | 18270 |
| ng | `activities/social03b_awei_tail_high.json` | object | 5 | 1 | 21262 |
| ng | `activities/social03b_awei_tail_low.json` | object | 5 | 1 | 20271 |
| ng | `activities/social04a_ajie_chat.json` | object | 5 | 1 | 11185 |
| ng | `activities/social04a_awei_chat.json` | object | 5 | 1 | 9665 |
| ng | `activities/social04b_dorm_invite.json` | object | 5 | 1 | 3523 |
| ng | `activities/social05b_ajie_goods_high.json` | object | 5 | 1 | 9249 |
| ng | `activities/social05b_ajie_goods_low.json` | object | 5 | 1 | 9959 |
| ng | `activities/social05b_awei_record_high.json` | object | 5 | 1 | 11539 |
| ng | `activities/social05b_awei_record_low.json` | object | 5 | 1 | 11542 |
| ng | `activities/social06a_ajie_chat.json` | object | 5 | 1 | 6913 |
| ng | `activities/social06a_awei_chat.json` | object | 5 | 1 | 6153 |
| ng | `activities/use-item.json` | object | 3 | 1 | 3051 |
| ng | `activities/work01a-patient1-start.json` | object | 3 | 1 | 1342 |
| ng | `activities/work01a-patient1.json` | object | 3 | 1 | 10459 |
| ng | `activities/work01a-patient2-start.json` | object | 3 | 1 | 1342 |
| ng | `activities/work01a-patient2.json` | object | 3 | 1 | 6858 |
| ng | `activities/work01a-patient3-start.json` | object | 3 | 1 | 1342 |
| ng | `activities/work01a-patient3.json` | object | 3 | 1 | 6874 |
| ng | `activities/work01a-patient4-start.json` | object | 3 | 1 | 1342 |
| ng | `activities/work01a-patient4.json` | object | 3 | 1 | 6861 |
| ng | `activities/work01a-patient5-start.json` | object | 3 | 1 | 1342 |
| ng | `activities/work01a-patient5.json` | object | 3 | 1 | 6861 |
| ng | `activities/work01a-patient6-start.json` | object | 3 | 1 | 1342 |
| ng | `activities/work01a-patient6.json` | object | 3 | 1 | 6869 |
| ng | `activities/work01a-patient7-start.json` | object | 3 | 1 | 1342 |
| ng | `activities/work01a-patient7.json` | object | 3 | 1 | 6866 |
| ng | `activity-calendar.json` | object | 2 | 0 | 15358 |
| ng | `activity-lists/achievement.json` | object | 3 | 0 | 1043 |
| ng | `activity-lists/default.json` | object | 2 | 0 | 1208 |
| ng | `activity-lists/dorm.json` | object | 3 | 0 | 181 |
| ng | `activity-lists/ending.json` | object | 3 | 0 | 539 |
| ng | `activity-lists/his-custom.json` | object | 3 | 0 | 235 |
| ng | `activity-lists/medical.json` | object | 3 | 0 | 427 |
| ng | `activity-lists/social.json` | object | 3 | 0 | 569 |
| ng | `activity-lists/special-event.json` | object | 3 | 0 | 411 |
| ng | `activity-lists/system.json` | object | 3 | 0 | 113 |
| ng | `activity-manifest.json` | object | 1 | 0 | 15586 |
| ng | `app-definitions.json` | object | 2 | 0 | 2852 |
| ng | `calendar-rules.json` | object | 2 | 0 | 424 |
| ng | `chatgtp-settings.json` | object | 3 | 0 | 252 |
| ng | `databases.json` | array | 21 | 0 | 2248 |
| ng | `desktop-icons.json` | array | 6 | 0 | 1443 |
| ng | `engine.json` | object | 16 | 0 | 1064 |
| ng | `item-placements.json` | object | 1 | 0 | 465 |
| ng | `media.json` | object | 4 | 0 | 9812 |
| ng | `onboarding.json` | array | 6 | 0 | 1533 |
| ng | `public-variables.json` | array | 113 | 0 | 24550 |
| ng | `seed-records-chatgtp.json` | object | 1 | 0 | 12026864 |
| ng | `seed-records.json` | object | 14 | 0 | 218802 |
| ng | `social-apps.json` | object | 3 | 0 | 275554 |
| ng | `structures.json` | array | 21 | 0 | 10650 |
| ng | `turtle-soup-puzzles.json` | object | 1 | 0 | 11295 |
| ng | `windows/chatgtp.json` | object | 9 | 4 | 8351 |
| ng | `windows/example.json` | object | 10 | 0 | 354 |
| ng | `windows/his.json` | object | 10 | 16 | 52309 |
| ng | `windows/off-duty.json` | object | 10 | 37 | 74144 |
