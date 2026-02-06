import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './User';
import { Resource } from './Resource';

interface ResourcePurchaseAttributes {
  id: string;
  userId: string;
  resourceId: string;
  price: number;
  platformFee: number;
  tutorEarnings: number;
  status: 'PENDING' | 'COMPLETED' | 'REFUNDED';
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  downloadCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ResourcePurchaseCreationAttributes extends Optional<ResourcePurchaseAttributes,
  'id' | 'status' | 'stripeCheckoutSessionId' | 'stripePaymentIntentId' | 'downloadCount'
> {}

export class ResourcePurchase extends Model<ResourcePurchaseAttributes, ResourcePurchaseCreationAttributes>
  implements ResourcePurchaseAttributes {
  public id!: string;
  public userId!: string;
  public resourceId!: string;
  public price!: number;
  public platformFee!: number;
  public tutorEarnings!: number;
  public status!: 'PENDING' | 'COMPLETED' | 'REFUNDED';
  public stripeCheckoutSessionId?: string;
  public stripePaymentIntentId?: string;
  public downloadCount!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ResourcePurchase.init(
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
    resourceId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'resource_id',
      references: {
        model: 'resources',
        key: 'id',
      },
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
    tutorEarnings: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'tutor_earnings',
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'COMPLETED', 'REFUNDED'),
      defaultValue: 'PENDING',
    },
    stripeCheckoutSessionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_checkout_session_id',
    },
    stripePaymentIntentId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_payment_intent_id',
    },
    downloadCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'download_count',
    },
  },
  {
    sequelize,
    tableName: 'resource_purchases',
    underscored: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'resource_id'],
      },
    ],
  }
);

// Associations
ResourcePurchase.belongsTo(User, { as: 'buyer', foreignKey: 'userId' });
ResourcePurchase.belongsTo(Resource, { as: 'resource', foreignKey: 'resourceId' });
User.hasMany(ResourcePurchase, { foreignKey: 'userId' });
Resource.hasMany(ResourcePurchase, { foreignKey: 'resourceId' });
