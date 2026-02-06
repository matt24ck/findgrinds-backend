import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface GardaVettingAttributes {
  id: string;
  tutorId: string;
  documentUrl: string;
  documentName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface GardaVettingCreationAttributes extends Optional<GardaVettingAttributes, 'id' | 'status' | 'submittedAt' | 'reviewedAt' | 'reviewedBy' | 'reviewNotes'> {}

export class GardaVetting extends Model<GardaVettingAttributes, GardaVettingCreationAttributes> implements GardaVettingAttributes {
  public id!: string;
  public tutorId!: string;
  public documentUrl!: string;
  public documentName!: string;
  public status!: 'PENDING' | 'APPROVED' | 'REJECTED';
  public submittedAt!: Date;
  public reviewedAt?: Date;
  public reviewedBy?: string;
  public reviewNotes?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

GardaVetting.init(
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
    documentUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      field: 'document_url',
    },
    documentName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'document_name',
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
      defaultValue: 'PENDING',
    },
    submittedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'submitted_at',
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'reviewed_at',
    },
    reviewedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'reviewed_by',
    },
    reviewNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'review_notes',
    },
  },
  {
    sequelize,
    tableName: 'garda_vetting',
    underscored: true,
  }
);
