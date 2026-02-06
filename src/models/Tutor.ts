import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './User';

interface TutorAttributes {
  id: string;
  userId: string;
  bio?: string;
  headline?: string;
  qualifications: string[];
  subjects: string[];
  levels: string[];
  baseHourlyRate: number;
  cancellationPolicy?: string;
  teachesInIrish: boolean;
  featuredTier: 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';
  featuredSubjects: object[];
  featuredUntil?: Date;
  rating: number;
  reviewCount: number;
  totalBookings: number;
  // Stripe Connect
  stripeConnectAccountId?: string;
  stripeConnectOnboarded: boolean;
  // Tutor Subscription (Verified/Professional tiers)
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?: 'active' | 'canceled' | 'past_due' | 'incomplete' | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TutorCreationAttributes extends Optional<TutorAttributes, 'id' | 'bio' | 'headline' | 'cancellationPolicy' | 'teachesInIrish' | 'featuredTier' | 'featuredSubjects' | 'featuredUntil' | 'rating' | 'reviewCount' | 'totalBookings' | 'stripeConnectAccountId' | 'stripeConnectOnboarded' | 'stripeSubscriptionId' | 'stripeSubscriptionStatus'> {}

export class Tutor extends Model<TutorAttributes, TutorCreationAttributes> implements TutorAttributes {
  public id!: string;
  public userId!: string;
  public bio?: string;
  public headline?: string;
  public qualifications!: string[];
  public subjects!: string[];
  public levels!: string[];
  public baseHourlyRate!: number;
  public cancellationPolicy?: string;
  public teachesInIrish!: boolean;
  public featuredTier!: 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';
  public featuredSubjects!: object[];
  public featuredUntil?: Date;
  public rating!: number;
  public reviewCount!: number;
  public totalBookings!: number;
  public stripeConnectAccountId?: string;
  public stripeConnectOnboarded!: boolean;
  public stripeSubscriptionId?: string;
  public stripeSubscriptionStatus?: 'active' | 'canceled' | 'past_due' | 'incomplete' | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Tutor.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: {
        model: 'users',
        key: 'id',
      },
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    headline: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    qualifications: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
    },
    subjects: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
    },
    levels: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
    },
    baseHourlyRate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'base_hourly_rate',
    },
    cancellationPolicy: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'cancellation_policy',
    },
    teachesInIrish: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'teaches_in_irish',
    },
    featuredTier: {
      type: DataTypes.ENUM('FREE', 'PROFESSIONAL', 'ENTERPRISE'),
      defaultValue: 'FREE',
      field: 'featured_tier',
    },
    featuredSubjects: {
      type: DataTypes.JSONB,
      defaultValue: [],
      field: 'featured_subjects',
    },
    featuredUntil: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'featured_until',
    },
    rating: {
      type: DataTypes.DECIMAL(2, 1),
      defaultValue: 0,
    },
    reviewCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'review_count',
    },
    totalBookings: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'total_bookings',
    },
    stripeConnectAccountId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_connect_account_id',
    },
    stripeConnectOnboarded: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'stripe_connect_onboarded',
    },
    stripeSubscriptionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_subscription_id',
    },
    stripeSubscriptionStatus: {
      type: DataTypes.ENUM('active', 'canceled', 'past_due', 'incomplete'),
      allowNull: true,
      field: 'stripe_subscription_status',
    },
  },
  {
    sequelize,
    tableName: 'tutors',
    underscored: true,
    timestamps: true,
  }
);

// Associations
Tutor.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(Tutor, { foreignKey: 'userId' });
