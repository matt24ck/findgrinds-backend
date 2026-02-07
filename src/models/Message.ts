import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface MessageAttributes {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isPredefined: boolean;
  onBehalfOfStudentId: string | null;
  readAt: Date | null;
  createdAt?: Date;
}

interface MessageCreationAttributes extends Optional<MessageAttributes, 'id' | 'isPredefined' | 'onBehalfOfStudentId' | 'readAt'> {}

export class Message extends Model<MessageAttributes, MessageCreationAttributes>
  implements MessageAttributes {
  public id!: string;
  public conversationId!: string;
  public senderId!: string;
  public content!: string;
  public isPredefined!: boolean;
  public onBehalfOfStudentId!: string | null;
  public readAt!: Date | null;
  public readonly createdAt!: Date;
}

Message.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'conversation_id',
      references: { model: 'conversations', key: 'id' },
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'sender_id',
      references: { model: 'users', key: 'id' },
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    isPredefined: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_predefined',
    },
    onBehalfOfStudentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'on_behalf_of_student_id',
      references: { model: 'users', key: 'id' },
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'read_at',
    },
  },
  {
    sequelize,
    tableName: 'messages',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);
