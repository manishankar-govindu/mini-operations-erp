import dotenv from 'dotenv';
dotenv.config();

const env = process.env;

export const config = {
  port: Number(env.PORT || 3001),
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
    database: env.NODE_ENV === 'test' ? env.TEST_DB_NAME || 'mini_erp_test' : env.DB_NAME || 'mini_erp',
  },
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
};
