import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './User';

interface TutorAttributes {
  id: string;
  userId: string;
  bio?: string;
  headline?: string;
  area?: string;
  qualifications: string[];
  subjects: string[];
  levels: string[];
  baseHourlyRate: number;
  cancellationNoticeHours: number;
  lateCancellationRefundPercent: number;
  teachesInIrish: boolean;
  isVisible: boolean;
  featuredTier: 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';
  featuredSubjects: object[];
  featuredUntil?: Date;
  rating: number;
  reviewCount: number;
  totalBookings: number;
  // Group sessions
  groupHourlyRate?: number;
  maxGroupSize: number;
  minGroupSize: number;
  // Stripe Connect
  stripeConnectAccountId?: string;
  stripeConnectOnboarded: boolean;
  // Tutor Subscription (Verified/Professional tiers)
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?: 'active' | 'canceled' | 'past_due' | 'incomplete' | null;
  // Organisation linking (Enterprise only)
  organisationName?: string;
  organisationWebsite?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TutorCreationAttributes extends Optional<TutorAttributes, 'id' | 'bio' | 'headline' | 'area' | 'cancellationNoticeHours' | 'lateCancellationRefundPercent' | 'teachesInIrish' | 'isVisible' | 'featuredTier' | 'featuredSubjects' | 'featuredUntil' | 'rating' | 'reviewCount' | 'totalBookings' | 'groupHourlyRate' | 'maxGroupSize' | 'minGroupSize' | 'stripeConnectAccountId' | 'stripeConnectOnboarded' | 'stripeSubscriptionId' | 'stripeSubscriptionStatus' | 'organisationName' | 'organisationWebsite'> {}

export class Tutor extends Model<TutorAttributes, TutorCreationAttributes> implements TutorAttributes {
  public id!: string;
  public userId!: string;
  public bio?: string;
  public headline?: string;
  public area?: string;
  public qualifications!: string[];
  public subjects!: string[];
  public levels!: string[];
  public baseHourlyRate!: number;
  public cancellationNoticeHours!: number;
  public lateCancellationRefundPercent!: number;
  public teachesInIrish!: boolean;
  public isVisible!: boolean;
  public featuredTier!: 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';
  public featuredSubjects!: object[];
  public featuredUntil?: Date;
  public rating!: number;
  public reviewCount!: number;
  public totalBookings!: number;
  public groupHourlyRate?: number;
  public maxGroupSize!: number;
  public minGroupSize!: number;
  public stripeConnectAccountId?: string;
  public stripeConnectOnboarded!: boolean;
  public stripeSubscriptionId?: string;
  public stripeSubscriptionStatus?: 'active' | 'canceled' | 'past_due' | 'incomplete' | null;
  public organisationName?: string;
  public organisationWebsite?: string;
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
    area: {
      type: DataTypes.STRING(50),
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
    cancellationNoticeHours: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 24,
      field: 'cancellation_notice_hours',
      validate: {
        isIn: [[6, 12, 24, 48, 72]],
      },
    },
    lateCancellationRefundPercent: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'late_cancellation_refund_percent',
      validate: {
        isIn: [[0, 25, 50, 75, 100]],
      },
    },
    teachesInIrish: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'teaches_in_irish',
    },
    isVisible: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_visible',
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
    groupHourlyRate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: 'group_hourly_rate',
    },
    maxGroupSize: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
      field: 'max_group_size',
      validate: {
        min: 2,
        max: 20,
      },
    },
    minGroupSize: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
      field: 'min_group_size',
      validate: {
        min: 2,
        max: 20,
      },
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
    organisationName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'organisation_name',
    },
    organisationWebsite: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'organisation_website',
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
