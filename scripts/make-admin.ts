import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';

dotenv.config();

const email = process.argv[2];

if (!email) {
  console.error('Usage: npx ts-node scripts/make-admin.ts <email>');
  process.exit(1);
}

async function makeAdmin() {
  const sequelize = new Sequelize(process.env.DATABASE_URL!, {
    dialect: 'postgres',
    logging: false,
  });

  try {
    await sequelize.authenticate();
    console.log('Connected to database');

    const [results] = await sequelize.query(
      `UPDATE users SET is_admin = true WHERE email = :email RETURNING id, email, first_name, last_name`,
      {
        replacements: { email },
      }
    );

    if ((results as any[]).length === 0) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }

    const user = (results as any[])[0];
    console.log(`✓ Made admin: ${user.first_name} ${user.last_name} (${user.email})`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

makeAdmin();
