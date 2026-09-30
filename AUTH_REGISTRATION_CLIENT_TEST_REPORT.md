# Client Test Report: Authentication and Registration

**Scope:** Authentication and account registration APIs only. Merchant KYC, CAC, payments, and other modules are out of scope.

**Test environment:** Use a staging environment and test email/phone accounts. API prefix is `/auth`. Send JSON requests with `Content-Type: application/json`. Do not run rate-limit or brute-force scenarios against production accounts.

## Environment and Test Data

- Record the deployed API base URL, build/version, test date, and tester before execution.
- Confirm database and Redis are available.
- For static OTP tests, set `OTP_MODE=static`; the code `123456` is accepted for registration email/mobile verification.
- For live phone OTP tests, set `OTP_MODE=live` and use a Twilio test/staging service and phone that can receive SMS. Email delivery also needs to be verified separately.
- Use unique email and mobile values for each registration unless a test explicitly checks duplicates or pending-registration reuse.
- Password schema currently accepts 6–100 characters. Record whether the client expects a stronger password policy.
- Capture HTTP status, response body, delivery outcome, and any unexpected behavior for each case. Never include real passwords, OTPs, bearer tokens, or secrets in the report shared outside the test team.

## Endpoint Inventory

| Method | Endpoint | Purpose | Authentication |
|---|---|---|---|
| POST | `/auth/register/initiate` | Create/update pending registration and issue OTPs | No |
| POST | `/auth/register/verify` | Verify email and mobile OTPs; create account | No |
| POST | `/auth/register/resend-otp` | Issue fresh registration OTPs | No |
| POST | `/auth/login` | Login or continue pending registration verification | No |
| POST | `/auth/refresh` | Exchange refresh token for access token | No |
| POST | `/auth/logout` | Revoke current stored refresh-token session | Access token |
| GET | `/auth/verify` | Validate access token and return identity claims | Access token |
| GET | `/auth/me` | Return current user identity | Access token |
| POST | `/auth/forgot-password` | Start password reset | No |
| POST | `/auth/reset-password` | Set a new password using reset OTP | No |
| POST | `/auth/change-password` | Change password for current account | Access token |

## Test Cases

### A. Registration Initiation

| ID | Scenario and test data | Expected result / verification |
|---|---|---|
| REG-01 | Valid first/last name, unique email/mobile, password of 6+ characters; omit role | `200`; pending registration is created; response says OTP was sent and expiry is 600 seconds. Role defaults to `MERCHANT`. |
| REG-02 | Repeat with explicit `USER` role | `200`; pending registration records `USER`. |
| REG-03 | Submit explicit `ADMIN` role | Public registration should reject or ignore privileged roles. **Security check:** current schema accepts `ADMIN`; raise as a defect if an admin account can be created this way. |
| REG-04 | Omit each required field in turn; send `null` or wrong types | Request is rejected by schema validation; no pending record or OTP delivery. |
| REG-05 | First/last name lengths 1, 2, 50, and 51 | Length 2–50 should pass; values outside the range should be rejected. Also test spaces-only names and record whether they are trimmed/rejected. |
| REG-06 | Malformed email, missing `@`, invalid domain, or empty email | Request is rejected; no OTP is issued. |
| REG-07 | Test local Nigerian, `+234`, and `234` phone formats, then malformed/foreign values | Confirm accepted formats and delivery behavior. **Current behavior:** registration only checks that `mobile` is a string; Nigerian phone regex is commented out. Invalid values may proceed in static mode and fail later in live Twilio verification. |
| REG-08 | Password lengths 5, 6, 100, and 101; simple/common password | 6–100 pass schema; 5 and 101 are rejected. Record if weak passwords are accepted; no complexity rule is currently defined. |
| REG-09 | Reuse an existing verified user's email, then reuse their mobile | Request should return a conflict and must not create/overwrite pending registration. |
| REG-10 | Initiate twice with same pending email/mobile | Second request should refresh the pending data and OTP expiry; confirm only the latest OTP works. |
| REG-11 | Existing pending phone with a different email, then retry using that phone | Confirm pending record and verification destination are updated to the latest submitted details, not stale details. |
| REG-12 | Request OTP repeatedly for one mobile | Verify throttling: OTP limiter is 30 requests per mobile per 10-minute window. After limit, expect a rate-limit response and no new OTP delivery. |
| REG-13 | Simulate Twilio/email provider failure | Confirm a controlled error is returned and no account is created. Record whether a pending record remains and whether retry is possible. |
| REG-14 | Check email inbox for OTP after initiate | Email OTP should arrive. **Current behavior to verify:** initial registration has email send commented out; OTP is logged by the backend instead. This may block client testing without a code-delivery fix or test procedure. |

### B. Registration OTP Verification

| ID | Scenario and test data | Expected result / verification |
|---|---|---|
| OTP-01 | Verify pending registration with valid email and mobile OTPs | `201`; exactly one user is created; merchant profile is created for `MERCHANT`; pending registration is deleted; access and refresh tokens plus redirect are returned. |
| OTP-02 | Wrong email OTP, correct mobile OTP | Rejected; no user created; pending record remains available for retry until expiry. |
| OTP-03 | Correct email OTP, wrong mobile OTP | Rejected; no user created. |
| OTP-04 | Both OTPs wrong | Rejected; no user created. |
| OTP-05 | OTP length 5 or 7; non-string/null OTP | Schema rejects request. Six non-digit characters pass length validation but should fail code verification. |
| OTP-06 | Verify after pending OTP expiry (10 minutes) | Rejected with `OTP_EXPIRED`; no user created. Resend should allow the user to continue. |
| OTP-07 | Verify with email belonging to one pending record and mobile belonging to another | Reject ambiguous/mismatched identity; do not verify or create either account. |
| OTP-08 | Verify same successful registration a second time | Rejected because pending registration is gone; no duplicate user/profile. |
| OTP-09 | Send two simultaneous valid verification requests | Only one transaction creates the account/profile; no duplicate user or orphan merchant profile. |
| OTP-10 | Static mode: use `123456` for both OTPs; then use wrong values | `123456` is currently accepted for both channels in static mode. Verify only in non-production; wrong values must fail. |
| OTP-11 | Live mode: use valid email OTP and Twilio-approved SMS OTP | Registration succeeds only after both checks pass. Wrong, expired, or unapproved Twilio code must fail. |
| OTP-12 | Check successful account fields and response for secrets | User details, role, tokens and redirect are returned; password/hash and OTP must not be returned. |

### C. Resend Registration OTP

| ID | Scenario and test data | Expected result / verification |
|---|---|---|
| RES-01 | Resend using valid mobile and pending registration | `200`; fresh OTPs are issued and expiry resets to 600 seconds. |
| RES-02 | Verify with old OTP after resend, then with new OTP | Old code should fail; latest code should pass. |
| RES-03 | Resend after original OTP expiry | New code should extend the pending registration by 10 minutes. |
| RES-04 | Resend for unknown email/mobile | Rejected; no OTP sent. |
| RES-05 | Resend repeatedly until limit | Same per-mobile 30-per-10-minute limiter applies; excess request is rejected. |
| RES-06 | Submit email only, without mobile | **Schema mismatch to verify:** route description says either email or mobile, but schema currently requires `mobile`; email-only request is rejected. |
| RES-07 | Submit mismatched email and mobile | Must not send an OTP for an unintended pending registration. Record which identity is selected and report any mismatch. |
| RES-08 | Check resend delivery in static and live OTP modes | Confirm email and SMS delivery separately. Current resend path sends email; SMS goes through Twilio only in live mode. |

### D. Login

| ID | Scenario and test data | Expected result / verification |
|---|---|---|
| LOG-01 | Valid email + correct password | `200`; access/refresh tokens and correct user/role/redirect returned. |
| LOG-02 | Valid mobile + correct password | Same successful behavior as email login. |
| LOG-03 | Email and mobile both omitted | Schema rejects request. |
| LOG-04 | Malformed email or invalid Nigerian mobile format | Schema rejects malformed identifier. |
| LOG-05 | Unknown account | `404` user-not-found response; no token issued. Check that response does not reveal unnecessary account data. |
| LOG-06 | Existing account, incorrect password | `401`; no token issued. |
| LOG-07 | Pending registration + correct password | Fresh OTPs issued; response indicates verification is required and returns pending email/mobile, without tokens. |
| LOG-08 | Pending registration + incorrect password | `401`; no OTP sent. |
| LOG-09 | Pending registration login hits OTP rate limit | Rate-limit response; no additional OTP sent. |
| LOG-10 | Merchant vs `USER`/`ADMIN` successful login | Merchant not yet onboarded redirects to KYC onboarding; non-merchant redirects to dashboard. Verify returned role matches stored role. |
| LOG-11 | Check response/logs | Password/hash and OTP must not be returned. Confirm no sensitive credentials are logged. |

### E. Access Token, Refresh, Logout, and Profile

| ID | Scenario and test data | Expected result / verification |
|---|---|---|
| TOK-01 | Call `/auth/verify` and `/auth/me` with a valid access token | `200`; identity data matches authenticated user. |
| TOK-02 | Call protected routes without Authorization header | `401`; no protected data returned. |
| TOK-03 | Invalid, tampered, expired access token | `401`. |
| TOK-04 | Use a refresh token as a bearer token on protected route | `401`; refresh token must not be accepted as an access token. |
| TOK-05 | Refresh with valid current refresh token | `200`; new access token works on protected endpoints. |
| TOK-06 | Refresh with access token, malformed, expired, or tampered token | `401`; no access token issued. |
| TOK-07 | Refresh after logout or password reset/change | Revoked refresh token must be rejected. |
| TOK-08 | Login twice and refresh using the first login's refresh token | Confirm session behavior: current implementation stores one refresh token per user, so a later login replaces the earlier token. |
| TOK-09 | Logout with current access token and matching refresh token | `200`; refresh session is invalidated; reusing it on `/auth/refresh` fails. |
| TOK-10 | Logout without access token or with refresh token as bearer token | `401`. |
| TOK-11 | Logout with a different/old refresh token | Verify the active session is not revoked. **Current behavior:** endpoint still reports successful logout even when the supplied token does not match; client should verify the active refresh token remains valid. |
| TOK-12 | Logout request with missing/malformed body | Confirm controlled validation/error response; route currently has no request-body schema. |

### F. Forgot and Reset Password

| ID | Scenario and test data | Expected result / verification |
|---|---|---|
| PWD-01 | Forgot password for a known account by email | `200`; reset OTP/link sent to account email; no password or token returned. |
| PWD-02 | Forgot password for a known account by mobile | `200`; reset delivered to account email; verify intended product behavior for mobile-only request. |
| PWD-03 | Forgot password with neither identifier or malformed identifier | Schema rejects request. |
| PWD-04 | Forgot password for unknown account | Current behavior is `404`; record account-enumeration risk and confirm intended public response policy. |
| PWD-05 | Forgot password with both email and mobile identifying different users | Email currently takes precedence; confirm mismatch is rejected or safely handled. |
| PWD-06 | Repeated forgot-password requests | Verify shared per-mobile OTP rate limiter and no excess emails. |
| PWD-07 | Inspect reset OTP generation/response in a non-production environment | **Critical implementation check:** current flow uses fixed `123456` regardless of `OTP_MODE`, and returns the OTP and reset link in the API response. This must not be accepted as production behavior. |
| PWD-08 | Reset with valid OTP and new password | Password changes; response confirms reset; refresh session is invalidated; user can log in with new password. |
| PWD-09 | Reset with wrong, missing, expired, or already-used OTP | Rejected; password remains unchanged. Reset OTP expiry is 600 seconds; successful reset deletes the OTP. |
| PWD-10 | Reset with new password lengths 5, 6, 100, and 101 | 6–100 should pass schema; 5 and 101 should fail. |
| PWD-11 | Reset to current password | Rejected with `SAME_AS_OLD_PASSWORD`; existing password remains valid. |
| PWD-12 | Reset with email and mobile for different accounts | Must reject mismatch and never reset a different user's password. Email currently takes precedence for user lookup. |
| PWD-13 | After successful reset, use old refresh token and old access token | Refresh token should fail. Check old access-token policy; current JWTs may remain usable until expiry. |

### G. Change Password

| ID | Scenario and test data | Expected result / verification |
|---|---|---|
| CHG-01 | Valid access token, correct old password, new password 6–100 chars | `200`; password changes; user can log in with new password. |
| CHG-02 | Missing/invalid/expired access token | `401`; password unchanged. |
| CHG-03 | Incorrect old password | Rejected; password unchanged. |
| CHG-04 | New password length 5 or 101 | Schema rejects request. |
| CHG-05 | New password equals current password | Confirm intended policy. Current service does not explicitly reject reuse for change-password (reset-password does). |
| CHG-06 | After successful change, reuse old refresh token | Refresh token should fail because session is deleted. Check old access token policy; it may remain valid until expiry. |
| CHG-07 | Response and logs | No password/hash or token should be exposed in logs or response. |

## Known Behaviors / Defects to Triage

These are based on the current implementation and should be confirmed against product requirements before client sign-off:

1. **Public role assignment:** registration accepts `ADMIN` as a public role. Public registration should normally permit only approved self-service roles; admin provisioning should be restricted.
2. **Initial email OTP delivery:** email sending is commented out in registration initiation, while the OTP is logged server-side. Resend does invoke email delivery. This can prevent the initial registration flow from working for a real client tester.
3. **Forgot-password OTP exposure:** OTP is fixed to `123456` regardless of OTP mode and included in the API response with the reset link. This is unsuitable for production and should be corrected before release.
4. **Registration phone validation:** Nigerian mobile regex is disabled in the registration and OTP verification schemas. Live Twilio validation occurs later, but static mode may accept malformed numbers.
5. **Resend contract mismatch:** schema requires `mobile` although route documentation indicates email or mobile can be used.
6. **Rate limiting:** OTP throttle allows up to 30 requests per mobile per 10 minutes; verify whether this is acceptable for abuse prevention and client QA.
7. **Password policy mismatch:** current policy is only length 6–100; no complexity or reuse rule is applied consistently across reset/change flows.
8. **Session invalidation:** password changes/resets revoke refresh session, but already-issued access tokens may remain usable until their normal expiry.

## Client Execution Sign-Off

For each case, mark **Pass / Fail / Blocked / Not Run**, record actual status and a sanitized response excerpt, and attach evidence such as test email/SMS delivery or screenshots. Do not attach live OTPs, passwords, authorization headers, API keys, or customer personal information. Log all defects by test ID and severity. Production sign-off should be blocked on any unresolved security defect above, especially public admin registration and reset-OTP exposure.
