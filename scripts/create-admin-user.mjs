import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/client/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

const email = 'admin@gmail.com';
const password = 'Admin@123';
const mobile = '+2348123456789';

const hashedPassword = await bcrypt.hash(password, 12);

const user = await prisma.user.upsert({
  where: { email },
  update: {
    firstName: 'Admin',
    lastName: 'User',
    mobile,
    password: hashedPassword,
    role: 'ADMIN',
    isVerified: true,
    isActive: true,
    kycStatus: 'APPROVED',
  },
  create: {
    firstName: 'Admin',
    lastName: 'User',
    email,
    mobile,
    password: hashedPassword,
    role: 'ADMIN',
    isVerified: true,
    isActive: true,
    kycStatus: 'APPROVED',
  },
});

console.log(JSON.stringify({
  id: user.id,
  email: user.email,
  role: user.role,
  isVerified: user.isVerified,
  isActive: user.isActive,
  mobile: user.mobile,
}, null, 2));

await prisma.$disconnect();
