import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './User';

interface TransactionAttributes {
  id: string;
  type: 'SESSION_BOOKING' | 'RESOURCE_PURCHASE' | 'FEATURED_SUBSCRIPTION' | 'STUDENT_SUBSCRIPTION';
  userId: string;
  relatedId?: string;
  amount: number;
  platformFee: number;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  stripeTransactionId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TransactionCreationAttributes extends Optional<TransactionAttributes, 'id' | 'relatedId' | 'stripeTransactionId'> {}

export class Transaction extends Model<TransactionAttributes, TransactionCreationAttributes> implements TransactionAttributes {
  public id!: string;
  public type!: 'SESSION_BOOKING' | 'RESOURCE_PURCHASE' | 'FEATURED_SUBSCRIPTION' | 'STUDENT_SUBSCRIPTION';
  public userId!: string;
  public relatedId?: string;
  public amount!: number;
  public platformFee!: number;
  public status!: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  public stripeTransactionId?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Transaction.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    type: {
      type: DataTypes.ENUM('SESSION_BOOKING', 'RESOURCE_PURCHASE', 'FEATURED_SUBSCRIPTION', 'STUDENT_SUBSCRIPTION'),
      allowNull: false,
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
    relatedId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'related_id',
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    platformFee: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'platform_fee',
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'),
      defaultValue: 'PENDING',
    },
    stripeTransactionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'stripe_transaction_id',
    },
  },
  {
    sequelize,
    tableName: 'transactions',
    underscored: true,
    timestamps: true,
  }
);

// Associations
Transaction.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Transaction, { foreignKey: 'userId' });
