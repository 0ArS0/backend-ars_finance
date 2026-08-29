import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto';

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Este e-mail já está cadastrado');

    const firstUser = (await this.prisma.user.count()) === 0;
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash: await this.hashPassword(dto.password)
      }
    });

    if (firstUser) await this.assignExistingData(user.id);
    return this.toPublicUser(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
    await this.prisma.session.create({
      data: {
        tokenHash: this.hashToken(token),
        userId: user.id,
        expiresAt
      }
    });

    return { token, user: this.toPublicUser(user) };
  }

  async logout(token: string | null) {
    if (token) {
      await this.prisma.session.deleteMany({ where: { tokenHash: this.hashToken(token) } });
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data = {
      name: dto.name?.trim(),
      email: dto.email?.trim().toLowerCase()
    };
    try {
      const user = await this.prisma.user.update({ where: { id: userId }, data });
      return this.toPublicUser(user);
    } catch {
      throw new ConflictException('Não foi possível atualizar o perfil');
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await this.verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Senha atual inválida');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(dto.newPassword) }
    });
    await this.prisma.session.deleteMany({ where: { userId } });
    return { success: true };
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, stored: string) {
    const [salt, key] = stored.split(':');
    if (!salt || !key) return false;
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    const storedKey = Buffer.from(key, 'hex');
    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private toPublicUser(user: { id: string; email: string; name: string; createdAt: Date; updatedAt: Date }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private async assignExistingData(userId: string) {
    await this.prisma.$transaction([
      this.prisma.financialAccount.updateMany({ where: { userId: null }, data: { userId } }),
      this.prisma.category.updateMany({ where: { userId: null }, data: { userId } }),
      this.prisma.payee.updateMany({ where: { userId: null }, data: { userId } }),
      this.prisma.beneficiary.updateMany({ where: { userId: null }, data: { userId } }),
      this.prisma.importMappingRule.updateMany({ where: { userId: null }, data: { userId } }),
      this.prisma.goal.updateMany({ where: { userId: null }, data: { userId } }),
      this.prisma.investmentAccount.updateMany({ where: { userId: null }, data: { userId } }),
      this.prisma.appSetting.updateMany({ where: { userId: null }, data: { userId } })
    ]);
  }
}
