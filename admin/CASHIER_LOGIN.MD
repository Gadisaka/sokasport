Cashier Device Restriction & Secure Login System
Production-Grade Approach for Betting Platforms
Goal

Prevent cashier account sharing while avoiding the problems caused by strict IP-only locking.

Instead of binding a cashier to a single IP address, implement:

Trusted device registration
Device fingerprinting
Session binding
Risk detection
Admin approval workflow
Optional IP monitoring

This approach is significantly more reliable and scalable for real betting systems.

Why NOT Use Single IP Locking

Strict IP locking creates many false positives.

Problems
Dynamic IPs

Many ISPs rotate IP addresses regularly.

Mobile networks

Mobile data changes IP constantly.

Shared networks

Several users may share the same public IP.

VPN bypass

Attackers can still bypass IP restrictions.

Router restarts

Even a reboot can assign a new IP.

Recommended Architecture
Main Concept

Each cashier account is tied to:

A trusted device
A device fingerprint
A signed device token
Optional IP reputation checks

Instead of:

cashier -> single IP

Use:

cashier -> trusted devices
Security Goals

The system should:

✅ Prevent account sharing
✅ Detect suspicious logins
✅ Allow legitimate IP changes
✅ Require admin approval for new devices
✅ Reduce fraud risk
✅ Maintain usability

High-Level Flow
First Login
↓
Register Trusted Device
↓
Store Fingerprint + Device Token
↓
Future Login Attempt
↓
Fingerprint Match?
↓ YES
Allow Login

    ↓ NO

Block Login
Require Admin Approval
PHASE 1 — Database Design

1. Trusted Devices Table
   Prisma Example
   model CashierTrustedDevice {
   id String @id @default(cuid())

cashierId String
cashier User @relation(fields: [cashierId], references: [id])

fingerprintHash String
deviceTokenHash String

firstIp String?
latestIp String?

userAgent String?
browser String?
os String?

country String?
city String?

approvedByAdmin Boolean @default(false)
isActive Boolean @default(true)

firstSeenAt DateTime @default(now())
lastSeenAt DateTime @updatedAt

revokedAt DateTime?

@@index([cashierId])
} 2. Login Audit Table

Track all login attempts.

model CashierLoginAttempt {
id String @id @default(cuid())

cashierId String?

ipAddress String
fingerprintHash String?

userAgent String?

success Boolean
reason String?

createdAt DateTime @default(now())

@@index([cashierId])
}
PHASE 2 — Device Fingerprinting
What Is Device Fingerprinting?

A method of identifying a device using:

browser data
OS
screen size
timezone
hardware info
canvas fingerprint
fonts
language
Recommended Option

Use:

FingerprintJS

Frontend Setup
Install
npm install @fingerprintjs/fingerprintjs
Generate Fingerprint
import FingerprintJS from '@fingerprintjs/fingerprintjs'

const fp = await FingerprintJS.load()

const result = await fp.get()

const fingerprint = result.visitorId
NEVER Store Raw Fingerprints

Always hash them.

import crypto from 'crypto'

const fingerprintHash = crypto
.createHash('sha256')
.update(fingerprint)
.digest('hex')
PHASE 3 — Device Token System
Why Device Tokens?

Fingerprints can slightly change.

A secure device token makes identification more reliable.

Login Success Flow

On successful login:

Generate secure device token
Save hashed token in DB
Send raw token to browser cookie
Generate Token
import crypto from 'crypto'

const deviceToken = crypto.randomBytes(48).toString('hex')
Hash Before Saving
const tokenHash = crypto
.createHash('sha256')
.update(deviceToken)
.digest('hex')
Send Cookie
res.cookie('device_token', deviceToken, {
httpOnly: true,
secure: true,
sameSite: 'strict',
maxAge: 1000 _ 60 _ 60 _ 24 _ 365
})
PHASE 4 — First Login Registration
First Login Logic
Cashier logs in
↓
No trusted device exists
↓
Register current device
↓
Mark approved
↓
Allow access
Backend Flow

1. Verify Credentials
   const cashier = await prisma.user.findUnique({
   where: { username }
   })
2. Create Trusted Device
   await prisma.cashierTrustedDevice.create({
   data: {
   cashierId: cashier.id,
   fingerprintHash,
   deviceTokenHash,
   firstIp: ip,
   latestIp: ip,
   approvedByAdmin: true
   }
   })
   PHASE 5 — Future Login Validation
   Validation Order
   Step 1 — Find Trusted Device
   const trustedDevice =
   await prisma.cashierTrustedDevice.findFirst({
   where: {
   cashierId: cashier.id,
   isActive: true
   }
   })
   Step 2 — Compare Fingerprint
   const fingerprintMatches =
   trustedDevice.fingerprintHash === fingerprintHash
   Step 3 — Compare Device Token
   const tokenMatches =
   trustedDevice.deviceTokenHash === tokenHash
   Decision Logic
   if (fingerprintMatches && tokenMatches) {
   allowLogin()
   } else {
   blockLogin()
   }
   PHASE 6 — Admin Approval System
   Why Needed?

When a cashier changes device:

new laptop
new browser
reinstalled OS

The system should NOT auto-allow.

New Device Flow
New Device Detected
↓
Block Login
↓
Create Pending Approval
↓
Notify Admin
↓
Admin Approves
↓
Device Becomes Trusted
Pending Approval Table
model CashierPendingDeviceApproval {
id String @id @default(cuid())

cashierId String

fingerprintHash String
deviceTokenHash String

ipAddress String

userAgent String?

status String @default("PENDING")

createdAt DateTime @default(now())
}
Admin Dashboard Example
Cashier: John
Old Device: Windows Chrome Addis
New Device: iPhone Safari Adama

Approve Device?
[Approve] [Reject]
Approval Logic
await prisma.cashierTrustedDevice.updateMany({
where: {
cashierId
},
data: {
isActive: false
}
})

await prisma.cashierTrustedDevice.create({
data: {
cashierId,
fingerprintHash,
deviceTokenHash,
approvedByAdmin: true,
isActive: true
}
})
PHASE 7 — IP Monitoring (Optional)
Recommended Usage

Use IP as:

✅ risk signal
❌ primary identity

Detect Suspicious Changes

Example:

Previous Login: Ethiopia
New Login: Russia (5 mins later)

Trigger:

temporary block
admin review
OTP verification
Suggested Rules
LOW RISK
same country
same city
same device

→ allow

MEDIUM RISK
same device
different IP

→ allow + log

HIGH RISK
different device
different country

→ block + require approval

PHASE 8 — Session Binding
Why Important?

Even if JWT is stolen:

attacker should not reuse it elsewhere
Bind Session To Device

Store:

jwtId
fingerprintHash
deviceTokenHash
ipRange
Verify On Every Request
if (
session.fingerprintHash !== currentFingerprintHash
) {
revokeSession()
}
PHASE 9 — VPN & Proxy Detection
Optional But Recommended

Detect:

VPNs
TOR
Datacenter IPs
Proxies
Useful Services
IPQualityScore
MaxMind
Cloudflare Turnstile
Example Rule
IF:
new device
AND vpn detected

THEN:
block immediately
PHASE 10 — Security Hardening
Rate Limiting

Prevent brute force attacks.

Express Example
npm install express-rate-limit
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
windowMs: 15 _ 60 _ 1000,
max: 10
})
Secure Cookies

Always use:

httpOnly: true
secure: true
sameSite: 'strict'
Rotate Refresh Tokens

Never use permanent JWTs.

Store Only Hashes

Never store:

raw device token
raw fingerprint

Always hash sensitive identifiers.

PHASE 11 — Recommended Production Rules
Suggested Policy
Cashier Accounts
Allowed
1 active trusted device
Requires Approval
new device
suspicious geo jump
Allowed Automatically
IP change only
Blocked
multiple active devices
device mismatch
VPN abuse
PHASE 12 — Recommended Stack
Backend
Node.js
Express.js
Prisma
Redis
Frontend
React
Next.js
Security
FingerprintJS
Cloudflare
Final Recommended Architecture
Cashier Login
↓
Verify Credentials
↓
Verify Trusted Device
↓
Verify Device Token
↓
Risk Analysis
↓
Allow OR Require Approval
Final Recommendation

DO NOT implement:

single IP only

IMPLEMENT:

trusted device system

- session binding
- optional IP monitoring
- admin approval workflow

This is:

✅ More secure
✅ More scalable
✅ More user-friendly
✅ Industry-standard
✅ Better for betting systems
✅ Easier to maintain long-term
