import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type SubscriptionTier = 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';

interface TutorSubscriptionAttributes {
  id: string;
  tutorId: string;
  tier: SubscriptionTier;
  // Payment info (null if admin-granted)
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  // Admin override - allows free access without payment
  isAdminGranted: boolean;
  adminGrantedBy?: string;
  adminGrantedAt?: Date;
  adminGrantedReason?: string;
  // Status
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelledAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TutorSubscriptionCreationAttributes extends Optional<TutorSubscriptionAttributes,
  'id' | 'stripeSubscriptionId' | 'stripePriceId' | 'isAdminGranted' | 'adminGrantedBy' |
  'adminGrantedAt' | 'adminGrantedReason' | 'status' | 'currentPeriodStart' | 'currentPeriodEnd' | 'cancelledAt'
> {}

export class TutorSubscription extends Model<TutorSubscriptionAttributes, TutorSubscriptionCreationAttributes>
  implements TutorSubscriptionAttributes {
  public id!: string;
  public tutorId!: string;
  public tier!: SubscriptionTier;
  public stripeSubscriptionId?: string;
  public stripePriceId?: string;
  public isAdminGranted!: boolean;
  public adminGrantedBy?: string;
  public adminGrantedAt?: Date;
  public adminGrantedReason?: string;
  public status!: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE';
  public currentPeriodStart?: Date;
  public currentPeriodEnd?: Date;
  public cancelledAt?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TutorSubscription.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tutorId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      field: 'tutor_id',
      references: {
        model: 'tutors',
        key: 'id',
      },
    },
    tier: {
      type: DataTypes.ENUM('FREE', 'PROFESSIONAL', 'ENTERPRISE'),
      allowNull: false,
      defaultValue: 'FREE',
    },
    stripeSubscriptionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_subscription_id',
    },
    stripePriceId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_price_id',
    },
    isAdminGranted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_admin_granted',
    },
    adminGrantedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'admin_granted_by',
    },
    adminGrantedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'admin_granted_at',
    },
    adminGrantedReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'admin_granted_reason',
    },
    status: {
      type: DataTypes.ENUM('ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE'),
      defaultValue: 'ACTIVE',
    },
    currentPeriodStart: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'current_period_start',
    },
    currentPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'current_period_end',
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'cancelled_at',
    },
  },
  {
    sequelize,
    tableName: 'tutor_subscriptions',
    underscored: true,
  }
);
