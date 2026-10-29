// Demo data: 3 users, 2 locations, 2 items, starting stock. Password for all users: password123
import bcrypt from 'bcryptjs';

export async function seedDatabase(client) {
  const hash = await bcrypt.hash('password123', 10);
  await client.query(`
    INSERT INTO users (username, password_hash, full_name, role) VALUES
      ('admin', $1, 'Admin User', 'admin'),
      ('ops', $1, 'Operations User', 'operations_user'),
      ('sales', $1, 'Sales User', 'sales_user')`, [hash]);
  await client.query(`
    INSERT INTO locations (code, name) VALUES ('MAIN', 'Main Warehouse'), ('NORTH', 'North Branch')`);
  await client.query(`INSERT INTO categories (name) VALUES ('Raw Material'), ('Finished Goods')`);
  await client.query(`
    INSERT INTO items (sku, name, category_id) VALUES
      ('ITEM-A', 'Item A', (SELECT id FROM categories WHERE name='Raw Material')),
      ('ITEM-B', 'Item B', (SELECT id FROM categories WHERE name='Finished Goods'))`);
  await client.query(`
    INSERT INTO inventory (location_id, item_id, physical_quantity, reserved_quantity)
    SELECT l.id, i.id, CASE WHEN l.code='MAIN' THEN 100 ELSE 40 END, 0
    FROM locations l CROSS JOIN items i`);
}
