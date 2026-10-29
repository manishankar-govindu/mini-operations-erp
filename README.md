# Mini Operations ERP

A small production-oriented full-stack ERP covering the flow:
**Inventory → Work Order → Stock Check → Internal Transfer / Shortage → Customer Reservation**

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite |
| Backend | Node.js 22, Express 4 |
| Database | PostgreSQL 13+ (tested on 16) |
| Auth | JWT (jsonwebtoken), bcrypt password hashing (bcryptjs) |
| Tests | Node built-in test runner (`node:test`) against a real PostgreSQL database |
| API docs | OpenAPI 3 (`backend/docs/openapi.yaml`) |

## Project structure

```
backend/
  db/schema.sql        Tables, constraints, sequences
  db/init.js           Applies schema (drops and recreates tables)
  db/seed.js           Demo users, locations, items, stock
  src/services/        Business logic and transactions
  src/routes.js        HTTP endpoints with role checks
  tests/               Mandatory tests + extra business-rule tests
  docs/openapi.yaml    API documentation
frontend/
  src/App.jsx          Login gate, navigation, role-based tabs
  src/pages.jsx        The 5 screens
docs/ER_DIAGRAM.md     Schema diagram and integrity decisions
docker-compose.yml     Optional local PostgreSQL
```

## Roles

| Action | Admin | Operations User | Sales User |
|---|:-:|:-:|:-:|
| Log in, view inventory / work orders / transfers / orders | ✔ | ✔ | ✔ |
| Add stock (stock-in) | ✔ | ✔ | |
| Create work order | ✔ | | |
| Start / complete work order | ✔ | ✔ | |
| Request, dispatch, receive transfer | ✔ | ✔ | |
| Create, cancel, complete customer order | ✔ | | ✔ |

Enforced in the backend by `authorize(...)` on every route. Unauthorized calls return `403`; missing or invalid tokens return `401`.

## Business rules implemented

- **Available = Physical − Reserved**, computed in SQL, never stored.
- **No negative stock or over-reservation**: enforced by locked checks in the service layer and by database CHECK constraints.
- **Work order shortage** = `max(0, required − available at location)`, calculated automatically.
- **Transfers**: request checks source availability; **dispatch** reduces source physical stock; **receive** increases destination physical stock. Destination is untouched before receipt.
- **A transfer can be received only once**: the status is checked under a row lock.
- **Customer orders** reserve stock atomically on creation; cancel releases the reservation; complete ships stock (physical and reserved both decrease).
- **Duplicate stock-in** is blocked by a required `idempotency_key`.
- **Concurrency**: all stock changes lock the stock row (`SELECT … FOR UPDATE`), so two simultaneous reservations for 80 and 50 against 100 units cannot both succeed.

## Environment variables

Copy `backend/.env.example` to `backend/.env` and adjust:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API port |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` | `localhost`, `5432`, `postgres`, `postgres` | PostgreSQL connection |
| `DB_NAME` | `mini_erp` | Development database |
| `TEST_DB_NAME` | `mini_erp_test` | Database used by `npm test` (it is wiped on every run; never point it at real data) |
| `JWT_SECRET` | dev placeholder | **Must be changed** for any real deployment |
| `JWT_EXPIRES_IN` | `8h` | Token lifetime |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |

Frontend (`frontend/.env`, optional): `VITE_API_BASE` — set only if the API is not reached through the Vite proxy.

No hosting-provider specifics are in the business code; any PostgreSQL instance works by changing the variables above.

## Database setup

Option A, Docker:
```bash
docker compose up -d db
```

Option B, existing PostgreSQL: create the database, e.g. `CREATE DATABASE mini_erp;` and `CREATE DATABASE mini_erp_test;`.

Then:
```bash
cd backend
cp .env.example .env         # edit credentials if needed
npm install
npm run db:init              # creates all tables
npm run db:seed              # demo data
```

Demo accounts (password `password123`): `admin`, `ops`, `sales`.

## How to run

Backend:
```bash
cd backend
npm start                    # http://localhost:3001/api
```

Frontend (second terminal):
```bash
cd frontend
npm install
npm run dev                  # http://localhost:5173
```

Open http://localhost:5173 and sign in.

## How to test

```bash
cd backend
npm test
```

The test script wipes and re-seeds `TEST_DB_NAME` before each test group, starts the API on a random port, and exercises HTTP endpoints against real PostgreSQL. It covers:

1. Cannot reserve more than available inventory (plus a concurrent 80/50 race)
2. Cannot transfer more than available inventory
3. Destination stock increases only after receipt
4. Same transfer cannot be received twice (plus a concurrent receive race)
5. Unauthorized user cannot perform restricted operations (wrong role, no token, forged token)

Additional tests cover duplicate stock-in, invalid quantities, cancel/complete releasing or consuming stock, automatic shortage calculation, and location isolation.

Frontend build check: `cd frontend && npm run build`.

## API documentation

Open `backend/docs/openapi.yaml` in Swagger Editor (https://editor.swagger.io) or import it into Postman.

## Known limitations

- Demo login only; there is no self-service user registration (users are created through `db/seedData.js` or direct SQL).
- Work orders record material shortage but do not consume stock when completed; this was left out of scope because the case study does not specify it.
- Users are not yet restricted to their assigned location; all users can see and act on all locations.
- Batch numbers are stored and supported by the schema, but the UI only uses the default batch.
