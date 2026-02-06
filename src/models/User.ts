import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface UserAttributes {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  userType: 'STUDENT' | 'PARENT' | 'TUTOR';
  profilePhotoUrl?: string;
  gardaVettingSelfDeclared: boolean;
  gardaVettingVerified: boolean;
  // Stripe
  stripeCustomerId?: string;
  // Admin and account status
  isAdmin: boolean;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  suspensionReason?: string;
  suspendedAt?: Date;
  suspendedBy?: string;
  // GDPR consent fields
  marketingConsent: boolean;
  analyticsConsent: boolean;
  consentDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'profilePhotoUrl' | 'gardaVettingSelfDeclared' | 'gardaVettingVerified' | 'stripeCustomerId' | 'isAdmin' | 'accountStatus' | 'suspensionReason' | 'suspendedAt' | 'suspendedBy' | 'marketingConsent' | 'analyticsConsent' | 'consentDate'> {}

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: string;
  public email!: string;
  public password!: string;
  public firstName!: string;
  public lastName!: string;
  public userType!: 'STUDENT' | 'PARENT' | 'TUTOR';
  public profilePhotoUrl?: string;
  public gardaVettingSelfDeclared!: boolean;
  public gardaVettingVerified!: boolean;
  public stripeCustomerId?: string;
  public isAdmin!: boolean;
  public accountStatus!: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  public suspensionReason?: string;
  public suspendedAt?: Date;
  public suspendedBy?: string;
  public marketingConsent!: boolean;
  public analyticsConsent!: boolean;
  public consentDate?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    firstName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'first_name',
    },
    lastName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'last_name',
    },
    userType: {
      type: DataTypes.ENUM('STUDENT', 'PARENT', 'TUTOR'),
      allowNull: false,
      field: 'user_type',
    },
    profilePhotoUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'profile_photo_url',
    },
    gardaVettingSelfDeclared: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'garda_vetting_self_declared',
    },
    gardaVettingVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'garda_vetting_verified',
    },
    stripeCustomerId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_customer_id',
    },
    isAdmin: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_admin',
    },
    accountStatus: {
      type: DataTypes.ENUM('ACTIVE', 'SUSPENDED', 'DELETED'),
      defaultValue: 'ACTIVE',
      field: 'account_status',
    },
    suspensionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'suspension_reason',
    },
    suspendedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'suspended_at',
    },
    suspendedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'suspended_by',
    },
    marketingConsent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'marketing_consent',
    },
    analyticsConsent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'analytics_consent',
    },
    consentDate: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'consent_date',
    },
  },
  {
    sequelize,
    tableName: 'users',
    underscored: true,
    timestamps: true,
  }
);
