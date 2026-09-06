# Legacy → ng migration inventory

Generated: 2026-09-06T11:07:59.305Z

This report is evidence for migration planning. It does not claim runtime parity.

## Corpus summary

- Legacy JSON files: **54**
- ng JSON files: **110**
- Legacy blueprints: **168**
- ng blueprints: **266**
- Legacy top-level IDs: **1052**
- ng top-level IDs: **48836**

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
| `activityEnd` | 172 | 275 |
| `activityExpiry` | 167 | 197 |
| `applyPublicVariableEffect` | 0 | 54 |
| `arithmetic` | 34 | 102 |
| `blockUntil` | 0 | 1 |
| `branch` | 19 | 41 |
| `choice` | 89 | 120 |
| `conditionalValue` | 0 | 11 |
| `consumeTime` | 466 | 679 |
| `createRecord` | 0 | 4 |
| `diceCheck` | 4 | 4 |
| `emitEvent` | 0 | 1 |
| `endCg` | 1 | 1 |
| `ending` | 6 | 6 |
| `findRecords` | 0 | 12 |
| `flowStart` | 168 | 266 |
| `getActivityInstanceCount` | 8 | 8 |
| `getGameTime` | 8 | 8 |
| `getGlobal` | 56 | 56 |
| `getProperty` | 0 | 11 |
| `getPublicVariable` | 0 | 40 |
| `getRecord` | 0 | 13 |
| `getVariable` | 0 | 8 |
| `hisRefresh` | 2 | 2 |
| `hisRenderDiagnosis` | 2 | 2 |
| `hisRenderPrescription` | 1 | 1 |
| `hisSelectPatient` | 1 | 1 |
| `hisSubmit` | 1 | 1 |
| `insertActivity` | 8 | 8 |
| `inventoryOperation` | 6 | 6 |
| `markOnboardingMilestone` | 0 | 6 |
| `openWindow` | 0 | 44 |
| `prerequisite` | 167 | 197 |
| `publicVariableCondition` | 0 | 2 |
| `randomBranch` | 2 | 2 |
| `runActivity` | 0 | 46 |
| `segmentBranch` | 21 | 21 |
| `setGlobal` | 64 | 64 |
| `setVariable` | 0 | 71 |
| `showCg` | 33 | 33 |
| `showImage` | 14 | 14 |
| `spellCast` | 3 | 3 |
| `spellEffect` | 2 | 2 |
| `statOperation` | 8 | 8 |
| `text` | 1285 | 1672 |
| `updateRecord` | 0 | 3 |

## Stable-ID differences

### Legacy IDs absent from ng

- Count: **0**
- None

### ng IDs absent from legacy

- Count: **47784**
- `1000`
- `1001`
- `achievement`
- `achievementCategory`
- `achievements`
- `acne_vulgaris`
- `acute_bronchitis`
- `acute_cystitis`
- `acute_gastritis`
- `acute_laryngitis`
- `acute_maxillary_sinusitis`
- `acute_myocardial_infarction`
- `acute_nasopharyngitis`
- `acute_pharyngitis`
- `acute_pyelonephritis`
- `acute_stress_disorder`
- `acute_tonsillitis`
- `acute_upper_respiratory_infection`
- `allergic_rhinitis`
- `alopecia_areata`
- `alzheimer_disease`
- `angina_pectoris`
- `app_his_custom`
- `applist`
- `asthma_unspecified`
- `…`
- `ulcerative_colitis`
- `urinary_incontinence`
- `urinary_tract_infection`
- `urticaria`
- `varicose_veins`
- `vertigo`
- `vitamin_b12_deficiency_anemia`
- `vitamin_d_deficiency`
- `vitiligo`
- `welcome`
- `work01a`
- `work01b`
- `work02a`
- `work02b`
- `work03a`
- `work03b`
- `work04a`
- `work04b`
- `work05a`
- `work05b`
- `work06a`
- `work06b`
- `work07a`
- `work07b`
- `workpub`

## Runtime/editor entry-point inventory

- Legacy data loaders: `js/apps/ChatGTPApp.js`, `js/apps/CustomWindowApp.js`, `js/apps/HISApp.js`, `js/apps/SocialMediaApp.js`, `js/core/AchievementManager.js`, `js/core/ActivityData.js`, `js/core/BgmManager.js`, `js/core/CalendarData.js`, `js/core/CGManager.js`, `js/core/DataLoader.js`, `js/core/EndingManager.js`, `js/core/FavorabilityManager.js`, `js/core/GlobalVariableManager.js`, `js/core/I18n.js`, `js/core/ItemManager.js`, `js/core/ItemPlacementManager.js`, `js/core/KeywordManager.js`, `js/core/LocationSystem.js`, `js/core/MedicalCaseManager.js`, `js/core/NpcStateManager.js`, `js/core/SkillManager.js`, `js/core/SpecialEventManager.js`, `js/core/TimeService.js`, `js/core/TurtleSoupManager.js`, `js/desktop/DevBgmEditorTab.js`, `js/desktop/DevCGEditorTab.js`, `js/desktop/DevDedicatedDataEditors.js`, `js/desktop/DevDialogueEditorTab.js`, `js/desktop/DevDormComputerTab.js`, `js/desktop/DeveloperMode.js`, `js/desktop/DevItemEditorTab.js`, `js/desktop/DevLocationEditorTab.js`, `js/desktop/DevTurtleSoupEditorTab.js`, `js/desktop/DormMode.js`, `js/desktop/EndingScreen.js`
- ng data loading: `ng/core/ActivityDefinitionStore.js`, `ng/core/ContentDocumentStore.js`, `ng/core/DataStore.js`, `ng/core/WindowDefinitionStore.js`, `ng/dev/devApi.js`, `ng/engine.js`
- Legacy developer editors: `js/core/CGManager.js`, `js/core/DataLoader.js`, `js/core/DeveloperConfig.js`, `js/desktop/DevBgmEditorTab.js`, `js/desktop/DevCGEditorTab.js`, `js/desktop/DevCustomWindowEditor.js`, `js/desktop/DevDialogueEditorTab.js`, `js/desktop/DevDormComputerTab.js`, `js/desktop/DeveloperMode.js`, `js/desktop/DevItemEditorTab.js`, `js/desktop/DevLocationEditorTab.js`, `js/desktop/DevTurtleSoupEditorTab.js`, `js/main.js`
- ng developer tools: `ng/dev/ActivityDebuggerView.js`, `ng/dev/ActivityEditorModel.js`, `ng/dev/ActivityEditorView.js`, `ng/dev/ActivityListManagerModel.js`, `ng/dev/ActivityListManagerView.js`, `ng/dev/DatabaseDebuggerView.js`, `ng/dev/DataStructureEditorView.js`, `ng/dev/DesktopIconEditorView.js`, `ng/dev/devApi.js`, `ng/dev/DeveloperMode.js`, `ng/dev/LegacyContentEditorView.js`, `ng/dev/OnboardingEditorView.js`, `ng/dev/PublicVariableDebuggerView.js`, `ng/dev/PublicVariableEditorView.js`, `ng/dev/WindowDefinitionManagerView.js`, `ng/dev/WindowEditorModel.js`, `ng/dev/WindowEditorView.js`, `ng/engine.js`, `ng/style.css`

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
| ng | `activities/default.json` | object | 3 | 1 | 1275 |
| ng | `activities/dorm_activity_day1.json` | object | 7 | 1 | 18464 |
| ng | `activities/dorm_activity_day2.json` | object | 7 | 1 | 17725 |
| ng | `activities/dorm_activity_day3.json` | object | 7 | 1 | 21293 |
| ng | `activities/dorm_activity_day4.json` | object | 7 | 1 | 15233 |
| ng | `activities/dorm_activity_day5.json` | object | 7 | 1 | 13571 |
| ng | `activities/medical-appointment-watcher.json` | object | 3 | 1 | 2943 |
| ng | `activities/off-duty-open.json` | object | 3 | 1 | 658 |
| ng | `activities/social01b_ajie_honor_of_kings.json` | object | 8 | 1 | 22001 |
| ng | `activities/social01b_awei_headphones.json` | object | 8 | 1 | 16848 |
| ng | `activities/social02a_ajie_chat.json` | object | 8 | 1 | 9533 |
| ng | `activities/social02a_awei_chat.json` | object | 8 | 1 | 10353 |
| ng | `activities/social02b_dorm_invite.json` | object | 8 | 1 | 3311 |
| ng | `activities/social03b_ajie_24_personality_high.json` | object | 9 | 1 | 21546 |
| ng | `activities/social03b_ajie_24_personality_low.json` | object | 9 | 1 | 17594 |
| ng | `activities/social03b_awei_tail_high.json` | object | 9 | 1 | 20473 |
| ng | `activities/social03b_awei_tail_low.json` | object | 9 | 1 | 19517 |
| ng | `activities/social04a_ajie_chat.json` | object | 8 | 1 | 10782 |
| ng | `activities/social04a_awei_chat.json` | object | 8 | 1 | 9318 |
| ng | `activities/social04b_dorm_invite.json` | object | 8 | 1 | 3290 |
| ng | `activities/social05b_ajie_goods_high.json` | object | 9 | 1 | 9051 |
| ng | `activities/social05b_ajie_goods_low.json` | object | 9 | 1 | 9728 |
| ng | `activities/social05b_awei_record_high.json` | object | 9 | 1 | 11261 |
| ng | `activities/social05b_awei_record_low.json` | object | 9 | 1 | 11250 |
| ng | `activities/social06a_ajie_chat.json` | object | 9 | 1 | 6794 |
| ng | `activities/social06a_awei_chat.json` | object | 9 | 1 | 6066 |
| ng | `activities/use-item.json` | object | 3 | 1 | 1994 |
| ng | `activities/work01a-patient1-start.json` | object | 3 | 1 | 920 |
| ng | `activities/work01a-patient1.json` | object | 3 | 1 | 10072 |
| ng | `activities/work01a-patient2-start.json` | object | 3 | 1 | 1278 |
| ng | `activities/work01a-patient2.json` | object | 3 | 1 | 6601 |
| ng | `activities/work01a-patient3-start.json` | object | 3 | 1 | 1278 |
| ng | `activities/work01a-patient3.json` | object | 3 | 1 | 6617 |
| ng | `activities/work01a-patient4-start.json` | object | 3 | 1 | 1278 |
| ng | `activities/work01a-patient4.json` | object | 3 | 1 | 6604 |
| ng | `activities/work01a-patient5-start.json` | object | 3 | 1 | 1278 |
| ng | `activities/work01a-patient5.json` | object | 3 | 1 | 6604 |
| ng | `activities/work01a-patient6-start.json` | object | 3 | 1 | 1278 |
| ng | `activities/work01a-patient6.json` | object | 3 | 1 | 6612 |
| ng | `activities/work01a-patient7-start.json` | object | 3 | 1 | 1278 |
| ng | `activities/work01a-patient7.json` | object | 3 | 1 | 6609 |
| ng | `activity-lists/default.json` | object | 2 | 0 | 1208 |
| ng | `chatgtp-settings.json` | object | 3 | 0 | 252 |
| ng | `databases.json` | array | 19 | 0 | 1675 |
| ng | `desktop-icons.json` | array | 6 | 0 | 1443 |
| ng | `engine.json` | object | 13 | 0 | 589 |
| ng | `legacy-content/zh-hans/achievements.json` | object | 2 | 0 | 11260 |
| ng | `legacy-content/zh-hans/app_his_custom.json` | object | 11 | 5 | 9483 |
| ng | `legacy-content/zh-hans/applist.json` | array | 1 | 0 | 127 |
| ng | `legacy-content/zh-hans/bgm.json` | object | 3 | 0 | 5163 |
| ng | `legacy-content/zh-hans/calendar.json` | object | 3 | 0 | 80 |
| ng | `legacy-content/zh-hans/cg.json` | object | 1 | 0 | 4234 |
| ng | `legacy-content/zh-hans/chatgtp_daily_import.json` | array | 6 | 0 | 134895 |
| ng | `legacy-content/zh-hans/chatgtp_qa.json` | object | 4 | 0 | 20585345 |
| ng | `legacy-content/zh-hans/diagnoses.json` | object | 2 | 0 | 62178 |
| ng | `legacy-content/zh-hans/endings.json` | object | 1 | 15 | 193149 |
| ng | `legacy-content/zh-hans/global_variables.json` | array | 111 | 0 | 10236 |
| ng | `legacy-content/zh-hans/item_placements.json` | object | 1 | 0 | 446 |
| ng | `legacy-content/zh-hans/items.json` | object | 1 | 57 | 269086 |
| ng | `legacy-content/zh-hans/keywords.json` | object | 1 | 0 | 57092 |
| ng | `legacy-content/zh-hans/locations.json` | object | 1 | 0 | 1861 |
| ng | `legacy-content/zh-hans/maininit.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/mainpub.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/medicines.json` | object | 2 | 0 | 74091 |
| ng | `legacy-content/zh-hans/npcs.json` | object | 1 | 0 | 3018 |
| ng | `legacy-content/zh-hans/skills.json` | object | 1 | 0 | 296 |
| ng | `legacy-content/zh-hans/social_apps.json` | object | 2 | 0 | 139828 |
| ng | `legacy-content/zh-hans/social01a.json` | object | 2 | 0 | 61 |
| ng | `legacy-content/zh-hans/social01b.json` | object | 2 | 2 | 45438 |
| ng | `legacy-content/zh-hans/social02a.json` | object | 2 | 2 | 23936 |
| ng | `legacy-content/zh-hans/social02b.json` | object | 1 | 1 | 4284 |
| ng | `legacy-content/zh-hans/social03a.json` | object | 2 | 0 | 61 |
| ng | `legacy-content/zh-hans/social03b.json` | object | 2 | 4 | 94171 |
| ng | `legacy-content/zh-hans/social04a.json` | object | 2 | 2 | 24443 |
| ng | `legacy-content/zh-hans/social04b.json` | object | 1 | 1 | 4263 |
| ng | `legacy-content/zh-hans/social05a.json` | object | 2 | 1 | 15407 |
| ng | `legacy-content/zh-hans/social05b.json` | object | 2 | 4 | 47276 |
| ng | `legacy-content/zh-hans/social06a.json` | object | 2 | 2 | 14871 |
| ng | `legacy-content/zh-hans/social06b.json` | object | 2 | 0 | 61 |
| ng | `legacy-content/zh-hans/social07a.json` | object | 2 | 0 | 61 |
| ng | `legacy-content/zh-hans/social07b.json` | object | 2 | 0 | 61 |
| ng | `legacy-content/zh-hans/socialpub.json` | object | 1 | 4 | 85621 |
| ng | `legacy-content/zh-hans/special_events.json` | object | 1 | 9 | 91513 |
| ng | `legacy-content/zh-hans/time_rules.json` | object | 7 | 0 | 246 |
| ng | `legacy-content/zh-hans/turtle_soups.json` | object | 1 | 0 | 10990 |
| ng | `legacy-content/zh-hans/work01a.json` | object | 1 | 7 | 59128 |
| ng | `legacy-content/zh-hans/work01b.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/work02a.json` | object | 1 | 8 | 63056 |
| ng | `legacy-content/zh-hans/work02b.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/work03a.json` | object | 1 | 9 | 70962 |
| ng | `legacy-content/zh-hans/work03b.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/work04a.json` | object | 1 | 7 | 55257 |
| ng | `legacy-content/zh-hans/work04b.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/work05a.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/work05b.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/work06a.json` | object | 1 | 9 | 70963 |
| ng | `legacy-content/zh-hans/work06b.json` | object | 1 | 0 | 20 |
| ng | `legacy-content/zh-hans/work07a.json` | object | 1 | 8 | 63136 |
| ng | `legacy-content/zh-hans/work07b.json` | object | 1 | 9 | 70960 |
| ng | `legacy-content/zh-hans/workpub.json` | object | 1 | 2 | 40893 |
| ng | `legacy-content-manifest.json` | object | 2 | 0 | 7711 |
| ng | `onboarding.json` | array | 6 | 0 | 1533 |
| ng | `public-variables.json` | array | 113 | 0 | 24550 |
| ng | `seed-records-chatgtp.json` | object | 1 | 0 | 12026864 |
| ng | `seed-records.json` | object | 12 | 0 | 204653 |
| ng | `structures.json` | array | 19 | 0 | 6699 |
| ng | `windows/chatgtp.json` | object | 9 | 4 | 8351 |
| ng | `windows/example.json` | object | 10 | 0 | 354 |
| ng | `windows/his.json` | object | 10 | 16 | 52309 |
| ng | `windows/off-duty.json` | object | 10 | 37 | 74144 |
