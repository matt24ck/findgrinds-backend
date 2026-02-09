// Export all models
export { User } from './User';
export { Tutor } from './Tutor';
export { Session } from './Session';
export { Resource } from './Resource';
export { Transaction } from './Transaction';
export { ResourcePurchase } from './ResourcePurchase';
export { TutorWeeklySlot } from './TutorWeeklySlot';
export { TutorDateOverride } from './TutorDateOverride';
export { ParentLink } from './ParentLink';
export { Conversation } from './Conversation';
export { Message } from './Message';
export { MessageReport } from './MessageReport';
export { ResourceReport } from './ResourceReport';
export { ReviewReport } from './ReviewReport';

// Import for side effects (associations)
import './User';
import './Tutor';
import './Session';
import './Resource';
import './Transaction';
import './ResourcePurchase';
import './TutorWeeklySlot';
import './TutorDateOverride';
import './ParentLink';
import './Conversation';
import './Message';
import './MessageReport';
import './ResourceReport';
import './ReviewReport';

// Messaging associations
import { Conversation } from './Conversation';
import { Message } from './Message';
import { MessageReport } from './MessageReport';
import { User } from './User';
import { Session } from './Session';
import { ReviewReport } from './ReviewReport';

Conversation.belongsTo(User, { as: 'student', foreignKey: 'studentId' });
Conversation.belongsTo(User, { as: 'tutor', foreignKey: 'tutorId' });
Conversation.hasMany(Message, { as: 'messages', foreignKey: 'conversationId' });

Message.belongsTo(Conversation, { as: 'conversation', foreignKey: 'conversationId' });
Message.belongsTo(User, { as: 'sender', foreignKey: 'senderId' });
Message.hasMany(MessageReport, { as: 'reports', foreignKey: 'messageId' });

MessageReport.belongsTo(Message, { as: 'message', foreignKey: 'messageId' });
MessageReport.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId' });

// Review report associations
ReviewReport.belongsTo(Session, { as: 'session', foreignKey: 'sessionId' });
ReviewReport.belongsTo(User, { as: 'reporter', foreignKey: 'reporterId' });
