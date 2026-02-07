import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Tutor } from './Tutor';

interface TutorWeeklySlotAttributes {
  id: string;
  tutorId: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string; // 'HH:mm' format
  medium: 'IN_PERSON' | 'VIDEO' | 'GROUP';
  createdAt?: Date;
  updatedAt?: Date;
}

interface TutorWeeklySlotCreationAttributes extends Optional<TutorWeeklySlotAttributes, 'id'> {}

export class TutorWeeklySlot extends Model<TutorWeeklySlotAttributes, TutorWeeklySlotCreationAttributes> implements TutorWeeklySlotAttributes {
  public id!: string;
  public tutorId!: string;
  public dayOfWeek!: number;
  public startTime!: string;
  public medium!: 'IN_PERSON' | 'VIDEO' | 'GROUP';
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TutorWeeklySlot.init(
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
    dayOfWeek: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'day_of_week',
      validate: {
        min: 0,
        max: 6,
      },
    },
    startTime: {
      type: DataTypes.STRING(5),
      allowNull: false,
      field: 'start_time',
      validate: {
        is: /^([01]\d|2[0-3]):(00|30)$/,
      },
    },
    medium: {
      type: DataTypes.ENUM('IN_PERSON', 'VIDEO', 'GROUP'),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'tutor_weekly_slots',
    underscored: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['tutor_id', 'day_of_week', 'start_time', 'medium'],
      },
    ],
  }
);

// Associations
TutorWeeklySlot.belongsTo(Tutor, { foreignKey: 'tutorId' });
Tutor.hasMany(TutorWeeklySlot, { foreignKey: 'tutorId' });
