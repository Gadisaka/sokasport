# Users & Roles Module

## Overview

The system supports multiple user roles with different permissions.

## Roles

### 1. Super Admin

Full system ownership.

Permissions:

- Manage admins
- Configure APIs
- System settings
- Access all modules

---

### 2. Admin

Main system controller.

Permissions:

- User management
- Game management
- Ticket management
- Wallet control
- Bonus configuration
- CMS management
- Reports

---

### 3. Financial Support

Handles payment operations.

Allowed:

- Approve deposits
- Reject deposits
- Approve withdrawals
- Reject withdrawals
- Hold withdrawals
- View reports

Not Allowed:

- Game management
- Ticket control
- Bonus management
- System configuration

---

### 4. Agent

View-only role.

Permissions:

- View dashboard
- View reports
- View cashier performance
- View tickets from assigned cashiers

Restrictions:

- Cannot modify any data

---

### 5. Cashier

Responsible for physical betting operations.

Permissions:

- Sell tickets
- Print tickets
- Cancel tickets (within allowed time)
- Pay winning tickets
- Execute cash out
- Handle deposits/withdrawals

---

### 6. Player

End users of the platform.

Permissions:

- Register/login
- Place bets
- Deposit
- Withdraw
- View tickets
- View wallet history

---

### 7. Ticket Buyer (No Account)

Player purchasing a ticket from a cashier.

Capabilities:

- Buy ticket
- Request cash out (under rules)
- Claim winnings

Restrictions:

- No account
- No wallet
