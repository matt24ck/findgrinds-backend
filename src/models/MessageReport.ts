import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export const MESSAGE_REPORT_REASONS = [
  'inappropriate',
  'harassment',
  'spam',
  'safety_concern',
  'off_platform_contact',
  'other',
] as const;
export type MessageReportReason = (typeof MESSAGE_REPORT_REASONS)[number];

export const MESSAGE_REPORT_SOURCES = ['user', 'auto_screening'] as const;
export type MessageReportSource = (typeof MESSAGE_REPORT_SOURCES)[number];

interface MessageReportAttributes {
  id: string;
  messageId: string;
  /** Null for automated reports (source = 'auto_screening'). */
  reporterId: string | null;
  reason: MessageReportReason;
  details: string | null;
  /** Who raised the report: a user, or the automated message screening service. */
  source: MessageReportSource;
  /** Machine-readable context (screening score, categories, matches). */
  metadata: Record<string, unknown> | null;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt?: Date;
}

interface MessageReportCreationAttributes extends Optional<MessageReportAttributes,
  'id' | 'reporterId' | 'details' | 'source' | 'metadata' | 'status' | 'reviewedBy' | 'reviewedAt'
> {}

export class MessageReport extends Model<MessageReportAttributes, MessageReportCreationAttributes>
  implements MessageReportAttributes {
  public id!: string;
  public messageId!: string;
  public reporterId!: string | null;
  public reason!: MessageReportReason;
  public details!: string | null;
  public source!: MessageReportSource;
  public metadata!: Record<string, unknown> | null;
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
      allowNull: true,
      field: 'reporter_id',
      references: { model: 'users', key: 'id' },
    },
    reason: {
      type: DataTypes.ENUM(...MESSAGE_REPORT_REASONS),
      allowNull: false,
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    source: {
      type: DataTypes.ENUM(...MESSAGE_REPORT_SOURCES),
      allowNull: false,
      defaultValue: 'user',
    },
    metadata: {
      type: DataTypes.JSONB,
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
    indexes: [
      // One user may report a given message once.
      { unique: true, fields: ['message_id', 'reporter_id'], name: 'message_reports_message_reporter_unique' },
      // The automated screener may flag a given message once.
      {
        unique: true,
        fields: ['message_id'],
        where: { source: 'auto_screening' },
        name: 'message_reports_auto_screening_unique',
      },
    ],
  }
);
