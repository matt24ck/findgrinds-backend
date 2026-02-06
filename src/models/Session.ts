import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Tutor } from './Tutor';
import { User } from './User';

interface SessionAttributes {
  id: string;
  tutorId: string;
  studentId: string;
  subject: string;
  level: string;
  sessionType: 'VIDEO' | 'IN_PERSON' | 'GROUP';
  scheduledAt: Date;
  durationMins: number;
  price: number;
  platformFee: number;
  meetingLink?: string;
  recordingUrl?: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  // Stripe payment tracking
  stripePaymentIntentId?: string;
  stripeTransferId?: string;
  paymentStatus: 'pending' | 'paid' | 'refunded' | 'failed';
  rating?: number;
  reviewText?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SessionCreationAttributes extends Optional<SessionAttributes, 'id' | 'meetingLink' | 'recordingUrl' | 'stripePaymentIntentId' | 'stripeTransferId' | 'paymentStatus' | 'rating' | 'reviewText'> {}

export class Session extends Model<SessionAttributes, SessionCreationAttributes> implements SessionAttributes {
  public id!: string;
  public tutorId!: string;
  public studentId!: string;
  public subject!: string;
  public level!: string;
  public sessionType!: 'VIDEO' | 'IN_PERSON' | 'GROUP';
  public scheduledAt!: Date;
  public durationMins!: number;
  public price!: number;
  public platformFee!: number;
  public meetingLink?: string;
  public recordingUrl?: string;
  public status!: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  public stripePaymentIntentId?: string;
  public stripeTransferId?: string;
  public paymentStatus!: 'pending' | 'paid' | 'refunded' | 'failed';
  public rating?: number;
  public reviewText?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Session.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tutorId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'tutor_id',
      references: {
        model: 'tutors',
        key: 'id',
      },
    },
    studentId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'student_id',
      references: {
        model: 'users',
        key: 'id',
      },
    },
    subject: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    level: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    sessionType: {
      type: DataTypes.ENUM('VIDEO', 'IN_PERSON', 'GROUP'),
      defaultValue: 'VIDEO',
      field: 'session_type',
    },
    scheduledAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'scheduled_at',
    },
    durationMins: {
      type: DataTypes.INTEGER,
      defaultValue: 60,
      field: 'duration_mins',
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    platformFee: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'platform_fee',
    },
    meetingLink: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'meeting_link',
    },
    recordingUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'recording_url',
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'),
      defaultValue: 'PENDING',
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 5,
      },
    },
    reviewText: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'review_text',
    },
    stripePaymentIntentId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_payment_intent_id',
    },
    stripeTransferId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_transfer_id',
    },
    paymentStatus: {
      type: DataTypes.ENUM('pending', 'paid', 'refunded', 'failed'),
      defaultValue: 'pending',
      field: 'payment_status',
    },
  },
  {
    sequelize,
    tableName: 'sessions',
    underscored: true,
    timestamps: true,
  }
);

// Associations
Session.belongsTo(Tutor, { as: 'tutor', foreignKey: 'tutorId' });
Session.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
Tutor.hasMany(Session, { foreignKey: 'tutorId' });
User.hasMany(Session, { foreignKey: 'studentId' });
