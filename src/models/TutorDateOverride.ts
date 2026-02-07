import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Tutor } from './Tutor';

interface TutorDateOverrideAttributes {
  id: string;
  tutorId: string;
  date: string; // DATEONLY 'YYYY-MM-DD'
  startTime: string; // 'HH:mm' format
  medium: 'IN_PERSON' | 'VIDEO' | 'GROUP';
  isAvailable: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TutorDateOverrideCreationAttributes extends Optional<TutorDateOverrideAttributes, 'id'> {}

export class TutorDateOverride extends Model<TutorDateOverrideAttributes, TutorDateOverrideCreationAttributes> implements TutorDateOverrideAttributes {
  public id!: string;
  public tutorId!: string;
  public date!: string;
  public startTime!: string;
  public medium!: 'IN_PERSON' | 'VIDEO' | 'GROUP';
  public isAvailable!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TutorDateOverride.init(
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
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
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
    isAvailable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'is_available',
    },
  },
  {
    sequelize,
    tableName: 'tutor_date_overrides',
    underscored: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['tutor_id', 'date', 'start_time', 'medium'],
      },
    ],
  }
);

// Associations
TutorDateOverride.belongsTo(Tutor, { foreignKey: 'tutorId' });
Tutor.hasMany(TutorDateOverride, { foreignKey: 'tutorId' });
