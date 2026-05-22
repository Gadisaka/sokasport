# Betting Platform System Architecture

## Overview

This document describes the architecture of the betting platform.

The system is divided into independent modules (services) that communicate through APIs.

Core goals:

- High performance
- Real-time updates
- Security
- Fraud prevention
- Scalability

---

# High Level Architecture

Client Applications

- Web App
- Mobile App
- Cashier POS
- Admin Panel

↓

API Gateway

↓

Core Services

- Auth Service
- User Service
- Wallet Service
- Betting Service
- Odds Service
- Cash Out Service
- Bonus Service
- Risk Engine
- Reporting Service

↓

Infrastructure

- Database
- Redis
- Message Queue
- Sports Data API

---

# 1. API Gateway

The API Gateway acts as the entry point for all requests.

Responsibilities:

- Authentication validation
- Rate limiting
- Routing requests to services
- Logging

Example endpoints:

/api/auth  
/api/users  
/api/tickets  
/api/wallet  
/api/matches

---

# 2. Authentication Service

Handles user login and authorization.

Features:

- Login
- Token generation (JWT)
- Password hashing
- Role validation

Supported roles:

- Super Admin
- Admin
- Financial Support
- Agent
- Cashier
- Player

---

# 3. User Service

Manages user accounts.

Functions:

- Create user
- Update user
- Disable user
- Assign roles
- Manage branches and cashiers

---

# 4. Wallet Service

Handles all financial operations.

Responsibilities:

- Deposit
- Withdraw
- Wallet balance updates
- Transaction history
- Cashier wallet management

Security rules:

- Every transaction recorded
- Balance calculated on server only
- Double spending prevention

---

# 5. Betting Service (Ticket Engine)

This is the core service that manages bets.

Functions:

- Create ticket
- Store ticket selections
- Calculate potential win
- Track ticket status
- Handle ticket cancellation
- Validate payouts

Ticket types:

- Online tickets
- Cashier tickets

---

# 6. Odds Service

Handles match odds and betting markets.

Responsibilities:

- Import matches from API
- Update odds
- Enable/disable markets
- Suspend matches

Data source:

Sports odds provider API.

Odds updates should be stored in Redis for fast access.

---

# 7. Cash Out Service

Handles early payouts.

Cash Out formula:

CashOut = Stake × CurrentOdds × System Margin

**Current Odds:** Product of odds for matches already won (not pending or lost matches).

**System Margin:** Admin sets (0.1 – 0.9).

Rules:

- Ticket must be valid
- Odds available
- No suspended match

---

# 8. Risk Engine

Protects the system from large losses or fraud.

Functions:

- Maximum payout limits
- Maximum bet limits
- Market exposure control
- Suspicious betting detection

Example checks:

- Abnormally large bets
- Repeated betting on same event
- Odds manipulation

---

# 9. Bonus Engine

Handles all promotions.

Supported bonuses:

- Welcome bonus
- Deposit bonus
- Accumulator bonus
- Cashback
- Referral bonus

Functions:

- Calculate bonus
- Apply bonus
- Track bonus usage

---

# 10. Reporting Service

Generates reports for admins.

Reports include:

- Ticket reports
- Transaction reports
- Wallet reports
- Bonus reports
- Cash out reports
- Payout reports

Reports should support filtering by:

- date
- branch
- cashier
- user

---

# 11. Real-Time Match Service

Handles live updates.

Functions:

- Live score updates
- Match status changes
- Odds updates

Implementation:

WebSockets or Server-Sent Events.

---

# Infrastructure

## Database

Recommended:

PostgreSQL or MySQL

Stores:

- users
- wallets
- tickets
- matches
- transactions

---

## Redis

Used for:

- live odds cache
- session storage
- real-time ticket calculations

Benefits:

- extremely fast reads
- reduces database load

---

## Message Queue

Recommended:

RabbitMQ or Kafka

Used for:

- match updates
- odds updates
- payout events
- reporting events

---

# Security Layer

Security protections include:

- JWT authentication
- Role-based access control
- Wallet audit logs
- Fraud detection

Sensitive operations:

- payouts
- wallet updates
- cash out execution

must always be server-validated.

---

# Ticket Buyer Rules (No Account)

Cashier sold tickets must follow special rules.

Cash out allowed only if:

- Minimum 3 matches won
- No live matches
- 30 minutes after last match ended

---

# Ticket Payout Restriction

Winning tickets must only be paid at the cashier where they were sold.

Validation:

ticket.cashier_id == current_cashier_id

If false → reject payout.

---

# Scalability Strategy

To support large traffic:

Use:

- horizontal scaling
- load balancers
- Redis caching
- message queues

Example capacity:

10,000+ tickets per minute.

---

# Recommended Tech Stack

Backend

Node.js (NestJS or Express)

Database

PostgreSQL

Cache

Redis

Message Queue

RabbitMQ

Frontend

React / Next.js

Admin Panel

React Dashboard

Real-Time

WebSockets
