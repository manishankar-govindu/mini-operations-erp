-- Mini Operations ERP schema (PostgreSQL 13+)
DROP TABLE IF EXISTS inventory_transactions, customer_orders, stock_transfers,
  work_orders, inventory, items, categories, locations, users CASCADE;
DROP SEQUENCE IF EXISTS wo_seq, transfer_seq, order_seq;

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  role          VARCHAR(30)  NOT NULL CHECK (role IN ('admin', 'operations_user', 'sales_user')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id   SERIAL PRIMARY KEY,
  code VARCHAR(20)  NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL
);

CREATE TABLE categories (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE items (
  id          SERIAL PRIMARY KEY,
  sku         VARCHAR(50)  NOT NULL UNIQUE,
  name        VARCHAR(150) NOT NULL,
  category_id INTEGER      NOT NULL REFERENCES categories(id),
  unit        VARCHAR(20)  NOT NULL DEFAULT 'pcs'
);

-- One stock row per (location, item, batch). batch is never NULL so the
-- UNIQUE constraint actually works (NULLs would be treated as distinct).
CREATE TABLE inventory (
  id                SERIAL PRIMARY KEY,
  location_id       INTEGER NOT NULL REFERENCES locations(id),
  item_id           INTEGER NOT NULL REFERENCES items(id),
  batch             VARCHAR(50) NOT NULL DEFAULT 'DEFAULT',
  physical_quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, item_id, batch),
  CONSTRAINT inv_physical_nonneg CHECK (physical_quantity >= 0),
  CONSTRAINT inv_reserved_nonneg CHECK (reserved_quantity >= 0),
  CONSTRAINT inv_reserved_le_physical CHECK (reserved_quantity <= physical_quantity)
);

-- Audit log. idempotency_key is UNIQUE so the same stock-in request can never be posted twice.
CREATE TABLE inventory_transactions (
  id              SERIAL PRIMARY KEY,
  inventory_id    INTEGER NOT NULL REFERENCES inventory(id),
  type            VARCHAR(30) NOT NULL CHECK (type IN (
                    'STOCK_IN', 'RESERVE', 'RELEASE', 'COMPLETE_ORDER',
                    'TRANSFER_OUT', 'TRANSFER_IN', 'DAMAGED')),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  reference       VARCHAR(50),
  idempotency_key VARCHAR(100) UNIQUE,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE wo_seq;
CREATE SEQUENCE transfer_seq;
CREATE SEQUENCE order_seq;

CREATE TABLE work_orders (
  id                SERIAL PRIMARY KEY,
  work_order_code   VARCHAR(20) NOT NULL UNIQUE DEFAULT ('WO-' || lpad(nextval('wo_seq')::text, 6, '0')),
  location_id       INTEGER NOT NULL REFERENCES locations(id),
  item_id           INTEGER NOT NULL REFERENCES items(id),
  required_quantity INTEGER NOT NULL CHECK (required_quantity > 0),
  shortage          INTEGER NOT NULL DEFAULT 0 CHECK (shortage >= 0),
  assigned_user_id  INTEGER NOT NULL REFERENCES users(id),
  status            VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED'
                    CHECK (status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')),
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- status moves REQUESTED -> DISPATCHED -> RECEIVED only. received_at is
-- set exactly once, which is what stops a transfer being received twice.
CREATE TABLE stock_transfers (
  id                      SERIAL PRIMARY KEY,
  transfer_code           VARCHAR(20) NOT NULL UNIQUE DEFAULT ('TR-' || lpad(nextval('transfer_seq')::text, 6, '0')),
  source_location_id      INTEGER NOT NULL REFERENCES locations(id),
  destination_location_id INTEGER NOT NULL REFERENCES locations(id),
  item_id                 INTEGER NOT NULL REFERENCES items(id),
  quantity                INTEGER NOT NULL CHECK (quantity > 0),
  status                  VARCHAR(20) NOT NULL DEFAULT 'REQUESTED'
                          CHECK (status IN ('REQUESTED', 'DISPATCHED', 'RECEIVED')),
  dispatched_at           TIMESTAMPTZ,
  received_at             TIMESTAMPTZ,
  created_by              INTEGER REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transfer_different_locations CHECK (source_location_id <> destination_location_id)
);

CREATE TABLE customer_orders (
  id           SERIAL PRIMARY KEY,
  order_code   VARCHAR(20) NOT NULL UNIQUE DEFAULT ('ORD-' || lpad(nextval('order_seq')::text, 6, '0')),
  location_id  INTEGER NOT NULL REFERENCES locations(id),
  item_id      INTEGER NOT NULL REFERENCES items(id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  customer_name VARCHAR(150) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'RESERVED'
               CHECK (status IN ('RESERVED', 'COMPLETED', 'CANCELLED')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_loc_item ON inventory(location_id, item_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_transfers_status ON stock_transfers(status);
CREATE INDEX idx_orders_status ON customer_orders(status);
