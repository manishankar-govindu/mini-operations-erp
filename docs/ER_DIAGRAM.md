# Database Schema / ER Diagram

Source of truth: `backend/db/schema.sql`.

```mermaid
erDiagram
    USERS ||--o{ WORK_ORDERS : "assigned to"
    USERS ||--o{ INVENTORY_TRANSACTIONS : "performed by"
    LOCATIONS ||--o{ INVENTORY : "holds"
    ITEMS ||--o{ INVENTORY : "stocked as"
    CATEGORIES ||--o{ ITEMS : "groups"
    INVENTORY ||--o{ INVENTORY_TRANSACTIONS : "audited by"
    LOCATIONS ||--o{ WORK_ORDERS : "at"
    ITEMS ||--o{ WORK_ORDERS : "material for"
    LOCATIONS ||--o{ STOCK_TRANSFERS : "source / destination"
    ITEMS ||--o{ STOCK_TRANSFERS : "moved"
    LOCATIONS ||--o{ CUSTOMER_ORDERS : "fulfilled from"
    ITEMS ||--o{ CUSTOMER_ORDERS : "ordered"

    USERS {
        int id PK
        varchar username UK
        varchar password_hash
        varchar role "admin | operations_user | sales_user"
    }
    LOCATIONS { int id PK
        varchar code UK
        varchar name }
    CATEGORIES { int id PK
        varchar name UK }
    ITEMS { int id PK
        varchar sku UK
        int category_id FK }
    INVENTORY {
        int id PK
        int location_id FK
        int item_id FK
        varchar batch "NOT NULL, default DEFAULT"
        int physical_quantity "CHECK >= 0"
        int reserved_quantity "CHECK >= 0 AND <= physical"
    }
    INVENTORY_TRANSACTIONS {
        int id PK
        int inventory_id FK
        varchar type "STOCK_IN, RESERVE, RELEASE, COMPLETE_ORDER, TRANSFER_OUT, TRANSFER_IN"
        int quantity "CHECK > 0"
        varchar idempotency_key UK
        int created_by FK
    }
    WORK_ORDERS {
        int id PK
        varchar work_order_code UK
        int location_id FK
        int item_id FK
        int required_quantity
        int shortage
        int assigned_user_id FK
        varchar status "ASSIGNED | IN_PROGRESS | COMPLETED"
    }
    STOCK_TRANSFERS {
        int id PK
        varchar transfer_code UK
        int source_location_id FK
        int destination_location_id FK
        int item_id FK
        int quantity
        varchar status "REQUESTED | DISPATCHED | RECEIVED"
        timestamptz received_at
    }
    CUSTOMER_ORDERS {
        int id PK
        varchar order_code UK
        int location_id FK
        int item_id FK
        int quantity
        varchar customer_name
        varchar status "RESERVED | COMPLETED | CANCELLED"
    }
```

## Key integrity decisions

- **Available quantity** is never stored; it is `physical_quantity - reserved_quantity`, so it cannot drift.
- **Database CHECK constraints** make negative stock and reserving beyond physical stock impossible even if application code is wrong.
- **One stock row per location + item + batch**, with batch never NULL, so the UNIQUE constraint works.
- **Row locks** (`SELECT ... FOR UPDATE`) on stock and transfer rows serialize concurrent requests.
- **Transfer state machine** `REQUESTED -> DISPATCHED -> RECEIVED` is checked under lock, so a transfer is credited to the destination at most once.
- **Idempotency key** on stock-in is UNIQUE in the audit log, preventing duplicate postings.
