import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Tutor } from './Tutor';

interface ResourceAttributes {
  id: string;
  tutorId: string;
  title: string;
  description?: string;
  fileUrl: string;
  previewUrl?: string;
  resourceType: 'PDF' | 'IMAGE' | 'VIDEO';
  subject: string;
  level: string;
  price: number;
  salesCount: number;
  rating: number;
  reviewCount: number;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'SUSPENDED';
  createdAt?: Date;
  updatedAt?: Date;
}

interface ResourceCreationAttributes extends Optional<ResourceAttributes, 'id' | 'description' | 'previewUrl' | 'salesCount' | 'rating' | 'reviewCount' | 'status'> {}

export class Resource extends Model<ResourceAttributes, ResourceCreationAttributes> implements ResourceAttributes {
  public id!: string;
  public tutorId!: string;
  public title!: string;
  public description?: string;
  public fileUrl!: string;
  public previewUrl?: string;
  public resourceType!: 'PDF' | 'IMAGE' | 'VIDEO';
  public subject!: string;
  public level!: string;
  public price!: number;
  public salesCount!: number;
  public rating!: number;
  public reviewCount!: number;
  public status!: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'SUSPENDED';
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Resource.init(
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
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    fileUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      field: 'file_url',
    },
    previewUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'preview_url',
    },
    resourceType: {
      type: DataTypes.ENUM('PDF', 'IMAGE', 'VIDEO'),
      defaultValue: 'PDF',
      field: 'resource_type',
    },
    subject: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    level: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    salesCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'sales_count',
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
    status: {
      type: DataTypes.ENUM('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED'),
      defaultValue: 'DRAFT',
    },
  },
  {
    sequelize,
    tableName: 'resources',
    underscored: true,
    timestamps: true,
  }
);

// Associations
Resource.belongsTo(Tutor, { as: 'tutor', foreignKey: 'tutorId' });
Tutor.hasMany(Resource, { foreignKey: 'tutorId' });
