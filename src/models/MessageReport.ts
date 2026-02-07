import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface MessageReportAttributes {
  id: string;
  messageId: string;
  reporterId: string;
  reason: 'inappropriate' | 'harassment' | 'spam' | 'safety_concern' | 'other';
  details: string | null;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt?: Date;
}

interface MessageReportCreationAttributes extends Optional<MessageReportAttributes,
  'id' | 'details' | 'status' | 'reviewedBy' | 'reviewedAt'
> {}

export class MessageReport extends Model<MessageReportAttributes, MessageReportCreationAttributes>
  implements MessageReportAttributes {
  public id!: string;
  public messageId!: string;
  public reporterId!: string;
  public reason!: 'inappropriate' | 'harassment' | 'spam' | 'safety_concern' | 'other';
  public details!: string | null;
  public status!: 'PENDING' | 'REVIEWED' | 'DISMISSED';
  public reviewedBy!: string | null;
  public reviewedAt!: Date | null;
  public readonly createdAt!: Date;
}

MessageReport.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'message_id',
      references: { model: 'messages', key: 'id' },
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'reporter_id',
      references: { model: 'users', key: 'id' },
    },
    reason: {
      type: DataTypes.ENUM('inappropriate', 'harassment', 'spam', 'safety_concern', 'other'),
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
    tableName: 'message_reports',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);
