// Export all models
export { User } from './User';
export { Tutor } from './Tutor';
export { Session } from './Session';
export { Resource } from './Resource';
export { Transaction } from './Transaction';
export { ResourcePurchase } from './ResourcePurchase';

// Import for side effects (associations)
import './User';
import './Tutor';
import './Session';
import './Resource';
import './Transaction';
import './ResourcePurchase';
