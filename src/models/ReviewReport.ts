import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface ReviewReportAttributes {
  id: string;
  sessionId: string;
  reporterId: string;
  reason: 'inappropriate' | 'harassment' | 'false_claims' | 'other';
  details: string | null;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt?: Date;
}

interface ReviewReportCreationAttributes extends Optional<ReviewReportAttributes,
  'id' | 'details' | 'status' | 'reviewedBy' | 'reviewedAt'
> {}

export class ReviewReport extends Model<ReviewReportAttributes, ReviewReportCreationAttributes>
  implements ReviewReportAttributes {
  public id!: string;
  public sessionId!: string;
  public reporterId!: string;
  public reason!: 'inappropriate' | 'harassment' | 'false_claims' | 'other';
  public details!: string | null;
  public status!: 'PENDING' | 'REVIEWED' | 'DISMISSED';
  public reviewedBy!: string | null;
  public reviewedAt!: Date | null;
  public readonly createdAt!: Date;
}

ReviewReport.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'session_id',
      references: { model: 'sessions', key: 'id' },
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'reporter_id',
      references: { model: 'users', key: 'id' },
    },
    reason: {
      type: DataTypes.ENUM('inappropriate', 'harassment', 'false_claims', 'other'),
      allowNull: false,
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'REVIEWED', 'DISMISSED'),
      defaultValue: 'PENDING',
    },
    reviewedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'reviewed_by',
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'reviewed_at',
    },
  },
  {
    sequelize,
    tableName: 'review_reports',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);
