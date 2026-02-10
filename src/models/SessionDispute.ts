import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Session } from './Session';
import { User } from './User';

interface SessionDisputeAttributes {
  id: string;
  sessionId: string;
  reporterId: string;
  reason: 'tutor_no_show' | 'poor_quality' | 'inappropriate_behavior' | 'other';
  details: string;
  evidenceKeys: string[];
  tutorResponse: string | null;
  tutorEvidenceKeys: string[] | null;
  respondedAt: Date | null;
  status: 'PENDING' | 'REFUNDED' | 'DISMISSED';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt?: Date;
}

interface SessionDisputeCreationAttributes extends Optional<SessionDisputeAttributes,
  'id' | 'evidenceKeys' | 'tutorResponse' | 'tutorEvidenceKeys' | 'respondedAt' | 'status' | 'reviewedBy' | 'reviewedAt'
> {}

export class SessionDispute extends Model<SessionDisputeAttributes, SessionDisputeCreationAttributes>
  implements SessionDisputeAttributes {
  public id!: string;
  public sessionId!: string;
  public reporterId!: string;
  public reason!: 'tutor_no_show' | 'poor_quality' | 'inappropriate_behavior' | 'other';
  public details!: string;
  public evidenceKeys!: string[];
  public tutorResponse!: string | null;
  public tutorEvidenceKeys!: string[] | null;
  public respondedAt!: Date | null;
  public status!: 'PENDING' | 'REFUNDED' | 'DISMISSED';
  public reviewedBy!: string | null;
  public reviewedAt!: Date | null;
  public readonly createdAt!: Date;
}

SessionDispute.init(
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
      type: DataTypes.ENUM('tutor_no_show', 'poor_quality', 'inappropriate_behavior', 'other'),
      allowNull: false,
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    evidenceKeys: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      field: 'evidence_keys',
    },
    tutorResponse: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'tutor_response',
    },
    tutorEvidenceKeys: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'tutor_evidence_keys',
    },
    respondedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'responded_at',
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'REFUNDED', 'DISMISSED'),
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
    tableName: 'session_disputes',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);

// Associations
SessionDispute.belongsTo(Session, { as: 'session', foreignKey: 'sessionId' });
SessionDispute.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId' });
Session.hasMany(SessionDispute, { as: 'disputes', foreignKey: 'sessionId' });
