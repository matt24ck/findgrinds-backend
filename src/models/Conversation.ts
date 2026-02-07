import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface ConversationAttributes {
  id: string;
  studentId: string;
  tutorId: string;
  lastMessageAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ConversationCreationAttributes extends Optional<ConversationAttributes, 'id' | 'lastMessageAt'> {}

export class Conversation extends Model<ConversationAttributes, ConversationCreationAttributes>
  implements ConversationAttributes {
  public id!: string;
  public studentId!: string;
  public tutorId!: string;
  public lastMessageAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Conversation.init(
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
    tutorId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'tutor_id',
      references: { model: 'users', key: 'id' },
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_message_at',
    },
  },
  {
    sequelize,
    tableName: 'conversations',
    underscored: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['student_id', 'tutor_id'],
      },
    ],
  }
);
