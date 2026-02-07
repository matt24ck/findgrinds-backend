import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './User';

interface ParentLinkAttributes {
  id: string;
  studentId: string;
  parentId: string | null;
  code: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED';
  expiresAt: Date;
  linkedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ParentLinkCreationAttributes extends Optional<ParentLinkAttributes,
  'id' | 'parentId' | 'status' | 'linkedAt'
> {}

export class ParentLink extends Model<ParentLinkAttributes, ParentLinkCreationAttributes>
  implements ParentLinkAttributes {
  public id!: string;
  public studentId!: string;
  public parentId!: string | null;
  public code!: string;
  public status!: 'PENDING' | 'ACTIVE' | 'EXPIRED';
  public expiresAt!: Date;
  public linkedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ParentLink.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    studentId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'student_id',
      references: { model: 'users', key: 'id' },
    },
    parentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'parent_id',
      references: { model: 'users', key: 'id' },
    },
    code: {
      type: DataTypes.STRING(8),
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'ACTIVE', 'EXPIRED'),
      defaultValue: 'PENDING',
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'expires_at',
    },
    linkedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'linked_at',
    },
  },
  {
    sequelize,
    tableName: 'parent_links',
    underscored: true,
    timestamps: true,
  }
);

ParentLink.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
ParentLink.belongsTo(User, { as: 'parent', foreignKey: 'parentId' });
