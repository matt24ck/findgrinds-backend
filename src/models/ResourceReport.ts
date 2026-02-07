import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Resource } from './Resource';
import { ResourcePurchase } from './ResourcePurchase';
import { User } from './User';

interface ResourceReportAttributes {
  id: string;
  resourceId: string;
  purchaseId: string;
  reporterId: string;
  reason: 'misleading_content' | 'poor_quality' | 'wrong_subject' | 'incomplete' | 'other';
  details: string | null;
  refundRequested: boolean;
  status: 'PENDING' | 'REFUNDED' | 'DISMISSED';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt?: Date;
}

interface ResourceReportCreationAttributes extends Optional<ResourceReportAttributes,
  'id' | 'details' | 'refundRequested' | 'status' | 'reviewedBy' | 'reviewedAt'
> {}

export class ResourceReport extends Model<ResourceReportAttributes, ResourceReportCreationAttributes>
  implements ResourceReportAttributes {
  public id!: string;
  public resourceId!: string;
  public purchaseId!: string;
  public reporterId!: string;
  public reason!: 'misleading_content' | 'poor_quality' | 'wrong_subject' | 'incomplete' | 'other';
  public details!: string | null;
  public refundRequested!: boolean;
  public status!: 'PENDING' | 'REFUNDED' | 'DISMISSED';
  public reviewedBy!: string | null;
  public reviewedAt!: Date | null;
  public readonly createdAt!: Date;
}

ResourceReport.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    resourceId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'resource_id',
      references: { model: 'resources', key: 'id' },
    },
    purchaseId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'purchase_id',
      references: { model: 'resource_purchases', key: 'id' },
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'reporter_id',
      references: { model: 'users', key: 'id' },
    },
    reason: {
      type: DataTypes.ENUM('misleading_content', 'poor_quality', 'wrong_subject', 'incomplete', 'other'),
      allowNull: false,
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    refundRequested: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'refund_requested',
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
    tableName: 'resource_reports',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);

// Associations
ResourceReport.belongsTo(Resource, { as: 'resource', foreignKey: 'resourceId' });
ResourceReport.belongsTo(ResourcePurchase, { as: 'purchase', foreignKey: 'purchaseId' });
ResourceReport.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId' });
Resource.hasMany(ResourceReport, { as: 'reports', foreignKey: 'resourceId' });
