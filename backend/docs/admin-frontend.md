# Admin Frontend Specification

## Overview

The Admin Panel is a web dashboard used by:

- Super Admin
- Admin
- Financial Support
- Agent
- Cashier (limited dashboard)

The frontend must follow these principles:

- Component-based architecture
- Maximum component reuse
- Hard-edge UI (no rounded corners)
- Simple PHP-style admin look
- Fast loading
- Table-heavy interface

Recommended stack:

- React or Next.js
- TypeScript
- Tailwind CSS or simple CSS modules
- Axios for API requests

---

# UI Design Rules

### Hard Edge UI

All UI elements must have:

```
border-radius: 0;
```

Examples:

Cards
Buttons
Tables
Inputs
Modals

---

### Color Style (Classic Admin Look)

Primary Colors

```
Background: #f2f2f2
Card Background: #ffffff
Border: #dcdcdc
Text: #222
Primary Button: #2d6cdf
Danger Button: #d32f2f
Success: #2e7d32
Warning: #f9a825
```

---

### Typography

Font stack:

```
font-family: Arial, Helvetica, sans-serif;
```

Avoid modern fonts.

---

# Project Structure

```
/admin
  /components
  /layouts
  /modules
  /pages
  /hooks
  /services
  /styles
```

---

# Core Layout Components

## AdminLayout

Main layout wrapper.

Responsibilities:

- Sidebar
- Header
- Page container

Structure:

```
AdminLayout
 ├ Sidebar
 ├ Header
 └ ContentArea
```

---

## Sidebar

Reusable navigation component.

Menu items:

```
Dashboard
Users
Branches
Cashiers
Tickets
Games
Wallet
Bonuses
Reports
CMS
Settings
```

Component name:

```
SidebarMenu
SidebarItem
```

---

## Header

Top navigation bar.

Contains:

- Page title
- Notifications
- Admin profile
- Logout button

Component name:

```
AdminHeader
```

---

# Reusable UI Components

These components must be reusable everywhere.

---

## Card Component

Used for dashboard metrics and sections.

Component:

```
Card
```

Props:

```
title
children
actions
```

Example:

```
<Card title="Total Users">
  10,245
</Card>
```

Style:

```
border: 1px solid #dcdcdc
padding: 16px
background: #fff
border-radius: 0
```

---

## Table Component

Used across the system.

Component:

```
DataTable
```

Features:

- sorting
- pagination
- search
- server-side loading

Props:

```
columns
data
loading
pagination
onSort
```

Example usage:

```
<DataTable
 columns={ticketColumns}
 data={tickets}
/>
```

---

## Button Component

Reusable button.

Component:

```
Button
```

Types:

```
primary
danger
success
warning
default
```

Example:

```
<Button type="primary">
Create User
</Button>
```

Style:

```
border-radius: 0
border: 1px solid #ccc
```

---

## Input Component

Reusable form input.

Components:

```
TextInput
SelectInput
NumberInput
Checkbox
DatePicker
```

All inputs must follow:

```
border-radius: 0
border: 1px solid #ccc
```

---

## Modal Component

Reusable modal dialog.

Component:

```
Modal
```

Used for:

- Create user
- Edit data
- Confirm actions

Props:

```
title
isOpen
onClose
footer
```

---

## Confirm Dialog

Used for destructive actions.

Component:

```
ConfirmDialog
```

Used when:

- deleting users
- cancelling tickets
- voiding matches

---

## Notification Component

Component:

```
ToastNotification
```

Types:

```
success
error
warning
info
```

---

# Dashboard Module

Location:

```
/modules/dashboard
```

Components:

```
DashboardStats
StatsCard
RecentTickets
RecentTransactions
```

Example cards:

```
Total Users
Active Tickets
Today's Bets
Total Revenue
Cash Out Amount
```

---

# Users Module

Location:

```
/modules/users
```

Components:

```
UserTable
CreateUserModal
EditUserModal
UserStatusToggle
```

Features:

- Create user
- Edit user
- Enable/disable user
- Assign roles

---

# Branch & Cashier Module

Location:

```
/modules/branches
```

Components:

```
BranchTable
CreateBranchModal
CashierTable
CreateCashierModal
WalletBalanceCard
```

Features:

- Create branches
- Manage cashiers
- Assign agents
- View cashier wallet

---

# Tickets Module

Location:

```
/modules/tickets
```

Components:

```
TicketSearch
TicketTable
TicketDetails
CancelTicketButton
PayoutTicketButton
BlockTicketButton
```

Search fields:

```
coupon number
receipt id
date
status
cashier
branch
```

---

# Games Module

Location:

```
/modules/games
```

Components:

```
SportsList
LeagueTable
MatchTable
MarketControls
SuspendMatchButton
CloseBettingButton
```

Features:

- enable match
- disable match
- suspend betting
- override result

---

# Wallet Module

Location:

```
/modules/wallet
```

Components:

```
WalletTable
WalletHistory
FillWalletModal
DeductWalletModal
TransactionTable
```

Used by:

Admin
Financial Support

---

# Bonus Module

Location:

```
/modules/bonuses
```

Components:

```
BonusTable
CreateBonusModal
AccumulatorBonusSettings
CashbackSettings
ReferralSettings
```

---

# Reports Module

Location:

```
/modules/reports
```

Components:

```
ReportFilters
TransactionReport
TicketReport
BonusReport
CashoutReport
PayoutReport
```

Features:

```
date filter
branch filter
cashier filter
export CSV
export PDF
```

---

# CMS Module

Location:

```
/modules/cms
```

Components:

```
BannerManager
PromotionEditor
AnnouncementEditor
RulesEditor
HowToPlayEditor
```

---

# Services Layer

Location:

```
/services
```

Each module should have an API service.

Example:

```
userService.ts
ticketService.ts
walletService.ts
gameService.ts
reportService.ts
```

Example request:

```
GET /api/admin/users
POST /api/admin/users
PUT /api/admin/users/:id
```

---

# Hooks

Location:

```
/hooks
```

Reusable hooks:

```
useAuth
usePagination
useTable
useModal
useFetch
```

---

# State Management

Recommended:

```
React Query
```

Used for:

- API caching
- server state
- loading states

---

# Error Handling

All API requests must handle:

```
loading
success
error
```

Display errors using:

```
ToastNotification
```

---

# Permissions Handling

Each page must check user role.

Example:

```
System ad
Admin → full access
Financial Support → wallet pages only
Agent → reports view only
Cashier → limited dashboard
```

Unauthorized actions must show:

```
Access Denied
```

---

# Performance Rules

Tables must use:

```
server side pagination
server side filtering
```

Never load large datasets in the browser.

---

# Admin UI Goal

The admin dashboard should feel like:

- classic PHP control panel
- clean
- simple
- table-driven
- fast
- functional

Avoid:

- animations
- rounded corners
- fancy UI effects

