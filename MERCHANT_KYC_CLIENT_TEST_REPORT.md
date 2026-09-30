# Client Test Report: Merchant KYC

**Scope:** Merchant onboarding and KYC APIs only. Authentication/registration testing is covered separately in `AUTH_REGISTRATION_CLIENT_TEST_REPORT.md`. Payments, QR, and other merchant features are out of scope.

**API prefix:** `/merchant`. Use a verified merchant account and a valid access token for protected routes. The face-link check/submit routes and NIBSS callback are public routes; their security checks are explicitly included below.

## Test Setup

- Use a staging environment, dedicated test merchants, test identity data, and test bank accounts. Do not submit real BVN, NIN, CAC, bank details, or selfie images to a sandbox unless authorized.
- Ensure database, Redis, Smile ID, Monnify and Cloudinary configuration match the scenario. Record `KYC_VERIFICATION_MODE`, `SMILE_ID_SERVER`, and `MONNIFY_BVN_MATCH` for each run.
- `KYC_VERIFICATION_MODE=static` skips live Smile ID identity/business/face verification; bank name enquiry still calls Monnify. When `MONNIFY_BVN_MATCH=off`, BVN-to-bank-account matching is skipped after account-name validation.
- For provider tests, use approved provider test fixtures. Sandbox responses can be `MANUAL_REVIEW` when a product is not enabled or the provider returns an ambiguous result.
- Expected behavior below describes the client acceptance target unless specifically marked **Current behavior / defect to verify**. Record request, HTTP status, sanitized response, provider outcome, and KYC status after every case.
- Never include full identity numbers, selfie/document images, access tokens, provider keys, or account numbers in shared screenshots/logs.

## Endpoint Inventory

| Method | Endpoint | Purpose | Authentication |
|---|---|---|---|
| GET | `/merchant/getBanks` | Load Monnify bank list | No |
| POST | `/merchant/kyc/business` | Save business type/profile and MCC | Access token |
| POST | `/merchant/kyc/bvn` | Verify BVN and capture consent | Access token |
| POST | `/merchant/kyc/face` | Submit selfie for applicable business types | Access token |
| POST | `/merchant/kyc/face/link` | Create phone selfie link and QR | Access token |
| GET | `/merchant/kyc/face/link/:token` | Check phone selfie link | Link token |
| POST | `/merchant/kyc/face/link/:token` | Submit selfie using phone link | Link token |
| POST | `/merchant/kyc/nin` | Verify NIN | Access token |
| GET | `/merchant/kyc/status` | Read check statuses and next step | Access token |
| POST | `/merchant/kyc/address` | Save business address and optional proof | Access token |
| POST | `/merchant/kyc/kyb` | Verify CAC/TIN/directors as applicable | Access token |
| POST | `/merchant/kyc/bank` | Verify settlement account/name | Access token |
| POST | `/merchant/kyc/submit` | Accept terms/privacy and submit for review | Access token |
| GET | `/merchant/me` | Retrieve merchant profile | Access token |
| POST | `/merchant/webhook/nibss` | Update legacy NIBSS merchant status | No; callback route |

## Test Cases

### A. Authentication, Access, and Status

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-A01 | Call every protected KYC endpoint without Authorization header | `401`; no KYC data is returned or changed. |
| KYC-A02 | Use malformed, expired, tampered, or refresh token as bearer token | `401`; only a valid access token is accepted. |
| KYC-A03 | Use a verified non-merchant account | KYC operations must not create or expose another user's merchant profile; expect a controlled denial/not-found response. |
| KYC-A04 | Use an unverified or inactive account token | KYC service rejects with verification-required response. |
| KYC-A05 | Read `/kyc/status` before starting onboarding | `nextStep` is `BUSINESS`; statuses show remaining checks and attempt counts. |
| KYC-A06 | Read `/kyc/status` after each step and after final submit | `nextStep` advances consistently: BUSINESS → BVN → FACE when required → NIN → ADDRESS → KYB when pending → BANK → DECISION → DONE after submission. Check branch-specific skips below. |
| KYC-A07 | Read `/merchant/me` as the account owner | Only fields needed by the frontend should be returned. **Security check:** current handler returns the full merchant record; verify BVN/NIN/account details are not unnecessarily exposed. |

### B. Business Profile and MCC

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-B01 | Submit valid business name, type, MCC, monthly volume, optional details | `200`; profile is saved and audit entry recorded. |
| KYC-B02 | Omit required fields, use unsupported business type/MCC, or send wrong field types | Schema rejects request; profile remains unchanged. |
| KYC-B03 | Business name length 1, 2, 100, 101; monthly volume 0, negative, positive | Name 2–100 and positive numeric volume pass; invalid boundaries fail. |
| KYC-B04 | Submit each restricted category (GAMBLING, WEAPONS_AMMUNITION, ADULT_CONTENT, UNLICENSED_MONEY_SERVICES, CRYPTOCURRENCY_UNLICENSED, PYRAMID_MLM_SCHEMES) | Rejected with `MCC_PROHIBITED`; business profile is not advanced. |
| KYC-B05 | Submit ordinary supported MCC and each DNFBP category | Accepted if other fields valid. DNFBP categories should trigger SCUML requirement for applicable registered business types. |
| KYC-B06 | Change business type before downstream checks; then change after BVN/face/NIN/KYB already completed | Confirm statuses and collected fields are reset/recomputed consistently. **Current behavior to verify:** business type remains editable; type changes reset CAC/TIN and recalculate face status in some cases, but do not explicitly clear every downstream identity/address/bank result. |
| KYC-B07 | Submit the same business profile repeatedly | Idempotent save; no duplicate merchant profile or unexpected status regression. |

### C. BVN and Consent

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-C01 | Call BVN before business profile is saved | Rejected with `STEP_LOCKED`; no verification attempt consumed. |
| KYC-C02 | Submit valid 11-digit numeric BVN, owner name, ISO datetime DOB, valid Nigerian phone, and `consent: true` | In static mode, verified by bypass; in live mode, Smile ID must return verified and names must be compatible. Consent timestamp/IP are recorded. |
| KYC-C03 | BVN length 10/12, letters, missing field, invalid DOB, invalid mobile | Schema rejects; no provider call. |
| KYC-C04 | Omit consent or send false | Rejected; BVN check must not proceed. |
| KYC-C05 | Submit wrong BVN or mismatching name/DOB in live mode | Rejected as mismatch; no verified status; attempt count decreases remaining attempts. |
| KYC-C06 | Retry failed BVN three times | First two failures return remaining attempts; third produces soft block. Further attempt is rejected until support action. |
| KYC-C07 | Submit BVN already associated with another merchant | Rejected with `BVN_ALREADY_LINKED`; no provider call or overwrite. |
| KYC-C08 | Resubmit identical already-verified BVN/name/DOB | Cached success; provider is not called again; consent is still captured. |
| KYC-C09 | Resubmit a different BVN after verification | Confirm identity-change policy; result must not leave a previously verified identity attached to new unverified input. |
| KYC-C10 | Provider rejection, timeout, or product not enabled | Clean mismatch response, no false `VERIFIED`; confirm remaining attempts and audit record. |

### D. Face / Liveness and Phone Link

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-D01 | Individual trader or sole proprietor completes verified BVN | Face step is required; status route points to `FACE`. |
| KYC-D02 | Partnership, limited liability, or incorporated trustees completes verified BVN | Face is skipped and status is marked verified/skipped; user proceeds to NIN. |
| KYC-D03 | Submit face before BVN | Rejected with `STEP_LOCKED`. |
| KYC-D04 | Submit empty/short selfie, invalid base64, image with/without data-URI prefix | Invalid/too-short input rejected or controlled provider error; no false verified status. Confirm image-size limits and supported MIME types. |
| KYC-D05 | Valid face image in static mode | Returns verified with confidence 100 due to static bypass. Do not treat this as a live biometric result. |
| KYC-D06 | Live face confidence >=85, 60–84.99, and <60; also provider manual/failed/no confidence | >=85 verified; 60–84.99 manual review; <60 and provider failure are routed to manual review; no hard face failure should block NIN. |
| KYC-D07 | Resubmit face after verified | Cached success; no repeated provider call. |
| KYC-D08 | Create face link before BVN, or after face is already verified | Before BVN: `STEP_LOCKED`; after verified: `ALREADY_VERIFIED`. |
| KYC-D09 | Create face link with no origin, allowed origin, and origin outside CORS allowlist | Link/QR uses configured public URL or allowed origin; unapproved origin is not used. Link expires after 600 seconds. |
| KYC-D10 | Check valid, malformed, unknown, and expired face-link token | Valid token returns valid; malformed token fails schema; unknown/expired token returns controlled not-found/expired error. |
| KYC-D11 | Submit selfie with valid face-link token; then reuse same token | On verified face, token should be invalidated and not reusable. **Current behavior to verify:** link is deleted only after `VERIFIED`; manual-review submissions leave it usable until expiry. |
| KYC-D12 | Submit wrong selfie repeatedly using direct endpoint and phone link | Ensure retry policy is intentional. **Current behavior to verify:** failed face is converted to manual review and `faceAttempts` is not incremented, so the documented attempt lockout may not activate. |
| KYC-D13 | Submit a phone-link selfie for a token belonging to another test merchant | Only the merchant bound to the unguessable token can be affected; token must not allow access to other KYC endpoints/data. |

### E. NIN

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-E01 | Submit NIN before face is verified/skipped/manual review | Rejected with `STEP_LOCKED`. |
| KYC-E02 | Submit valid 11-digit numeric NIN after eligible face state | Static mode bypasses provider; live mode checks against BVN-verified name/DOB. Success sets NIN verified and raises KYC level to Tier 2. |
| KYC-E03 | NIN length 10/12 or non-numeric | Schema rejects; no provider call. |
| KYC-E04 | Wrong/unmatched NIN in live mode | Rejected with `NIN_MISMATCH`; attempt count updated. |
| KYC-E05 | Retry failed NIN three times and then submit again | Third failure soft-blocks; further attempts are rejected. |
| KYC-E06 | NIN already linked to another merchant | Rejected with `NIN_ALREADY_LINKED`. |
| KYC-E07 | Smile ID returns Not Done/manual review, provider rejection, or timeout | Must not be marked verified; confirm stable user-facing error and audit behavior. |

### F. Address and Proof of Address

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-F01 | Submit valid address after business profile | Address saved; status route advances to the next required step. |
| KYC-F02 | Submit address before business profile | Rejected with `STEP_LOCKED`. |
| KYC-F03 | Address line 1 length <5; city/state/LGA <2; required fields missing | Schema rejects; no address saved. |
| KYC-F04 | Individual trader submits address without proof image | Accepted; proof URL/submission timestamp remain empty. |
| KYC-F05 | Any other business type omits proof image | Rejected with `ADDRESS_PROOF_REQUIRED`. |
| KYC-F06 | Submit valid proof image as base64/data URI | Cloudinary upload succeeds; secure URL and submission timestamp are saved; raw base64 is not persisted/returned. |
| KYC-F07 | Invalid image, unsupported payload, oversized image, or Cloudinary outage | Controlled error; no partially updated address or false proof-submitted timestamp. |
| KYC-F08 | Change address after submitting proof | Confirm old proof is not misrepresented as proof for the new address; check timestamp and URL semantics. |

### G. KYB: CAC, TIN, Directors, SCUML

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-G01 | Submit KYB before address/LGA is saved | Rejected with `STEP_LOCKED`. |
| KYC-G02 | Individual trader submits KYB | CAC/TIN gate is skipped and marked verified; Smile ID is not called. |
| KYC-G03 | Sole proprietor submits KYB | CAC/TIN/sector-license fields are cleared and gate is skipped; Smile ID is not called. |
| KYC-G04 | Partnership submits no CAC, TIN, or directors | Rejected with the first relevant required-field error. |
| KYC-G05 | Limited liability submits valid CAC, TIN, at least one director, and applicable SCUML | CAC/TIN/director checks run; success or manual review follows provider results. |
| KYC-G06 | Incorporated trustees submits valid CAC and TIN | Required identifier checks run; verify director/SCUML requirements against product policy (current service does not require directors for this type). |
| KYC-G07 | Registered business submits missing CAC; partnership/limited liability missing TIN or directors | Rejected with `CAC_REQUIRED`, `TIN_REQUIRED`, or `DIRECTORS_REQUIRED`; data is not partially persisted. |
| KYC-G08 | DNFBP MCC (real estate, jewelry/precious metals, legal, accounting, casino/gaming) for partnership/limited liability without SCUML | Rejected with `SCUML_REQUIRED`; provide SCUML and retry. Verify other business types against policy. |
| KYC-G09 | CAC/TIN already linked to another merchant | Rejected with `CAC_ALREADY_LINKED` / `TIN_ALREADY_LINKED`. |
| KYC-G10 | Director list contains malformed BVN/NIN, invalid role, or ownership outside 0–100 | Schema rejects before provider call. Test zero and 100 boundary values. |
| KYC-G11 | Live Smile ID director BVN/NIN success, mismatch, and provider rejection | Every new director must pass both checks before KYB data/directors are persisted; one mismatch rejects the submission. |
| KYC-G12 | Resubmit a director with same BVN already recorded for this merchant | Existing director check is reused; no duplicate director row/provider verification. |
| KYC-G13 | Live CAC active + name match; active + name mismatch; inactive; failed; manual-review/ambiguous response; API rejection | Only verified + active + name match yields CAC verified. Mismatch/inactive/manual/ambiguous/API error must not falsely verify; provider errors are currently parked for manual review. |
| KYC-G14 | CAC values with RC/BN/IT prefix, numeric-only value, malformed prefix, or whitespace | Verify submitted number matches accepted Smile ID format; backend currently strips leading letters but not spaces or internal punctuation. |
| KYC-G15 | Live TIN verified, failed, manual review, or API rejection | Correct status stored; provider rejection should be manual review, not a server 500. |
| KYC-G16 | Static mode submit CAC/TIN/directors | CAC/TIN are marked verified without live Smile ID calls; director personal checks are bypassed. Ensure this is never mistaken for production validation. |
| KYC-G17 | Repeat KYB with changed CAC/TIN/director data | Confirm no stale verified values/director rows survive a changed identity/business submission. |

### H. Banks and Settlement Account

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-H01 | Call `/merchant/getBanks` with provider available | `200`; bank names/codes are returned for dropdown use. |
| KYC-H02 | Bank-list provider outage or invalid credentials | Controlled provider error; frontend can recover/retry; no sensitive provider details exposed. |
| KYC-H03 | Submit bank step while CAC or TIN is still `PENDING` | Rejected with `STEP_LOCKED`. |
| KYC-H04 | Submit valid numeric 10-digit account number and valid 3–6 digit bank code | Monnify account name enquiry runs; account and code are saved only after successful response. |
| KYC-H05 | Bank code length 2/3/6/7, alphabetic code; account length 9/10/11, alphabetic account | Only numeric bank code of length 3–6 and exactly 10-digit account number pass schema. |
| KYC-H06 | Monnify returns invalid account/bank combination or not-found | Clean invalid-account error; no bank details saved. |
| KYC-H07 | Submitted account name matches Monnify name with case/order/initial differences | Apply the documented name-match behavior; status should be verified only when accepted by matching policy. |
| KYC-H08 | Submitted account name does not match Monnify name | `MANUAL_REVIEW`; never auto-approve. |
| KYC-H09 | Name matches, `KYC_VERIFICATION_MODE=static` or `MONNIFY_BVN_MATCH=off` | Account name validation occurs; BVN-account match is skipped and NUBAN status currently becomes verified. Confirm test result is labeled as provider-match-bypassed. |
| KYC-H10 | Name matches and live Monnify BVN-account matching is enabled; test FULL/PARTIAL/NO_MATCH | FULL/PARTIAL currently become verified; NO_MATCH becomes manual review. Confirm this policy is approved by client. |
| KYC-H11 | Submit a different account after a previous bank verification | Ensure old bank details/status are not retained if new validation fails. |

### I. Final Submission and Review

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-I01 | Submit without `termsAccepted: true` or `privacyConsentAccepted: true` | Schema rejects; consent timestamps/status do not change. |
| KYC-I02 | Submit final decision before bank step | Rejected with `STEP_LOCKED` while NUBAN is pending. |
| KYC-I03 | Submit after bank check is verified | Consent timestamps saved; merchant status changes to `PENDING_REVIEW`; response confirms submission. |
| KYC-I04 | Submit when BVN/NIN/CAC/TIN/face/bank are manual review or failed but no longer pending | Confirm expected behavior. **Current behavior:** final submit is allowed after bank status is no longer pending, and all merchants go to admin review regardless of check results. |
| KYC-I05 | Submit twice after status is PENDING_REVIEW or ACTIVE | Second request rejected with `ALREADY_SUBMITTED`; no duplicate decision audit. |
| KYC-I06 | Read `/kyc/status` after final submission | `merchantStatus` is `PENDING_REVIEW`, `nextStep` is `DONE`. |
| KYC-I07 | Verify consent values and audit trail | Both accepted timestamps are stored; audit events should match each completed/failed step without exposing raw identity values unnecessarily. |

### J. Public NIBSS Callback / Legacy Route

| ID | Scenario | Expected result / verification |
|---|---|---|
| KYC-J01 | Submit malformed merchant UUID, missing NIBSS ID, or invalid status | Schema rejects; merchant record is unchanged. |
| KYC-J02 | Submit callback for unknown merchant UUID | Controlled not-found response; no status change. |
| KYC-J03 | Submit APPROVED, REJECTED, UNDER_REVIEW, and PENDING statuses | Confirm approved/rejected mapping is correct. **Current behavior:** only `APPROVED` maps to `ACTIVE`; every other allowed enum value maps to `REJECTED`. |
| KYC-J04 | Submit callback repeatedly or alter merchantId/status without provider authentication | **Critical security check:** callback route is public and has no visible signature/authentication validation; verify unauthorized callers cannot activate/reject an arbitrary merchant. Treat as release blocker unless protected upstream. |

## Current Behaviors / Defects to Triage

1. **Public NIBSS callback trust:** callback route has no application-level authentication/signature check and can update merchant status based on submitted UUID/status. Confirm whether a trusted gateway protects it; otherwise block release.
2. **Merchant profile data exposure:** `/merchant/me` returns the full merchant record. Confirm sensitive BVN/NIN/bank fields are not exposed to the frontend unnecessarily.
3. **KYC status means admin review, not approval:** final submission always transitions to `PENDING_REVIEW`; no check combination auto-approves a merchant.
4. **Manual-review steps can continue:** final submit is allowed if the bank status is not pending, even if identity/KYB checks are manual review or failed. Confirm this aligns with compliance policy.
5. **Attempt policy differs by check:** BVN/NIN failures count toward a three-attempt soft block. Face failure is converted to manual review and does not increment `faceAttempts`; phone link is deleted only on verified result.
6. **Business type remains editable:** changing it can reset selected checks while leaving other earlier results/fields in place. Test for stale or inconsistent KYC data.
7. **Static mode is not verification:** static mode marks BVN/NIN/face/CAC/TIN verified without live Smile ID validation. Bank BVN match is also skipped if configured off.
8. **Provider-dependent manual review:** Smile ID business responses are read defensively; missing/ambiguous fields may cause manual review. Confirm the active Smile ID sandbox product and test fixtures before judging CAC behavior.
9. **MCC list is placeholder policy:** restricted and DNFBP categories are hardcoded in the backend; client compliance should approve the category list and SCUML rules.

## Client Execution Sign-Off

Mark every case **Pass / Fail / Blocked / Not Run**. Attach sanitized evidence, HTTP status, KYC status before/after, provider sandbox result code, and defect ID where needed. Redact names, BVN/NIN/CAC, bank/account numbers, selfies, access tokens, and API credentials. Production sign-off should be blocked on any unresolved security issue and on any KYC state transition that can produce a false verified result.
