import Anthropic from '@anthropic-ai/sdk';
import {
  searchTutorsForAI,
  searchResourcesForAI,
  getTutorAvailabilityForAI,
  AITutorResult,
  AIResourceResult,
} from './searchService';

/**
 * FindGrinds AI assistant ("powered by Sonraí AI").
 *
 * A stateless concierge: the full conversation history is sent on every turn.
 * Tutor/resource data is surfaced exclusively through DB-backed tools, so the
 * model can never invent a tutor, a price, or an id — it only ever passes
 * filter parameters and the server returns real rows (mirrors the enrgy pattern).
 */

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 5;
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY = 20;

/** Resolve the Anthropic key: FindGrinds-specific first, then a generic fallback. */
function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY_FINDGRINDS || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'No Anthropic API key configured. Set ANTHROPIC_API_KEY_FINDGRINDS (or ANTHROPIC_API_KEY as a fallback).'
    );
  }
  return key;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatUser {
  firstName?: string;
  userType?: string;
}

export interface ChatResult {
  reply: string;
  tutors: AITutorResult[];
  resources: AIResourceResult[];
}

const LEVELS = ['JC', 'LC', 'BOTH'];
const RESOURCE_TYPES = ['PDF', 'IMAGE', 'VIDEO'];

const tools: Anthropic.Tool[] = [
  {
    name: 'search_tutors',
    description:
      'Search FindGrinds for real, currently-available tutors. Use this whenever the user is ' +
      'looking for a tutor/grind, or asks who is available for a subject/level/area/budget. ' +
      'Only ever present tutors returned by this tool — never invent a tutor, name, price, or rating. ' +
      'Pass only the filters the user actually specified; omit the rest. Returns up to 6 tutors.',
    input_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description:
            'Exact subject code, UPPERCASE, e.g. MATHS, ENGLISH, IRISH, BIOLOGY, CHEMISTRY, ' +
            'PHYSICS, FRENCH, GERMAN, SPANISH, GEOGRAPHY, HISTORY, BUSINESS, ACCOUNTING, ECONOMICS.',
        },
        level: { type: 'string', enum: LEVELS, description: 'JC = Junior Cert, LC = Leaving Cert.' },
        area: { type: 'string', description: 'Location/area, e.g. "Dublin", "Cork". Matched exactly.' },
        minPrice: { type: 'number', description: 'Minimum hourly rate in EUR.' },
        maxPrice: { type: 'number', description: 'Maximum hourly rate in EUR (budget cap).' },
        minRating: { type: 'number', description: 'Minimum average rating, 0–5.' },
        teachesInIrish: { type: 'boolean', description: 'True to only return tutors who teach through Irish.' },
      },
    },
  },
  {
    name: 'search_resources',
    description:
      'Search FindGrinds for real, published study resources (notes, papers, videos). Use when the ' +
      'user wants study materials/resources rather than a live tutor. Only present resources returned ' +
      'by this tool. Pass only the filters the user specified. Returns up to 6 resources.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Exact subject code, UPPERCASE (see search_tutors).' },
        level: { type: 'string', enum: LEVELS, description: 'JC or LC.' },
        resourceType: { type: 'string', enum: RESOURCE_TYPES, description: 'Type of resource.' },
        minPrice: { type: 'number', description: 'Minimum price in EUR.' },
        maxPrice: { type: 'number', description: 'Maximum price in EUR.' },
      },
    },
  },
  {
    name: 'get_tutor_availability',
    description:
      "Get a tutor's next available 1:1 session slots over the next two weeks. Use this only after " +
      'a tutor has been surfaced by search_tutors and the user asks when they are free / about ' +
      'booking. Pass the exact tutorId from a previous search_tutors result.',
    input_schema: {
      type: 'object',
      properties: {
        tutorId: { type: 'string', description: 'The id of a tutor returned by search_tutors.' },
      },
      required: ['tutorId'],
    },
  },
];

function buildSystemPrompt(user?: ChatUser): string {
  const greetingName = user?.firstName ? ` The signed-in user's first name is ${user.firstName}; greet them by name naturally.` : '';
  return [
    'You are the friendly AI assistant for FindGrinds.ie, Ireland\'s marketplace for Junior Cert (JC) and',
    'Leaving Cert (LC) grinds (private tutoring). You help students and parents find the right tutor or',
    'study resource, and answer questions about how FindGrinds works. This assistant is provided as a',
    'Sonraí AI integration.' + greetingName,
    '',
    'WHAT YOU CAN DO:',
    '- Find tutors via the search_tutors tool (by subject, level, area, budget, rating, Irish-language).',
    '- Find study resources via the search_resources tool.',
    '- Tell a user a tutor\'s next availability via get_tutor_availability.',
    '- Explain how FindGrinds works using the knowledge below.',
    '',
    'HARD RULES (never break these):',
    '- ONLY ever mention tutors/resources returned by the tools. NEVER invent or assume a tutor, name,',
    '  price, rating, or availability. If a search returns nothing, say so honestly and suggest broadening',
    '  the search (e.g. a wider budget, drop the area filter, or a related subject).',
    '- NEVER quote a price or rating the tool did not return — the app renders the real figures on the cards.',
    '- When the request is vague, ask ONE focused follow-up (which subject? JC or LC? budget? online or in their area?)',
    '  before searching. If they say "you pick", just search sensibly with what you have.',
    '- To book, users tap the "Book Now" button on a tutor card (it links to the booking page). You never',
    '  take payment or confirm a booking yourself — you guide them to it.',
    '- Keep replies short, warm and plain-English. Do not output raw ids or URLs in your text; the cards carry the links.',
    '',
    'HOW FINDGRINDS WORKS (knowledge for general questions):',
    '- FindGrinds connects students/parents with vetted Irish grinds tutors for JC and LC subjects.',
    '- Find a tutor → open their profile → "Book Now" → pick a slot. Sessions can be online (video),',
    '  in-person, or group sessions, paid securely via Stripe at booking time.',
    '- Many tutors are Garda-vetted; a verified badge shows on their card and profile for safety/trust.',
    '- Some tutors teach through Irish (trí Ghaeilge) — filter for this if asked.',
    '- Tutors set their own hourly rate. Resources are one-off purchases (notes, past papers, videos).',
    '- FindGrinds takes a small platform fee on bookings and resource sales; tutors keep the rest.',
    '- For detailed pricing/subscription tiers, point users to the /pricing page; for common questions, /faq.',
    '- Subjects use UPPERCASE codes internally (MATHS, ENGLISH, IRISH, BIOLOGY, CHEMISTRY, PHYSICS, etc.);',
    '  translate the user\'s natural wording to the right code when searching.',
  ].join('\n');
}

/** Keep only valid turns, cap length, and trim to the most recent MAX_HISTORY messages. */
function sanitize(messages: ChatMessage[]): ChatMessage[] {
  const clean = (messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  return clean.slice(-MAX_HISTORY);
}

interface Collected {
  tutors: Map<string, AITutorResult>;
  resources: Map<string, AIResourceResult>;
}

/** Execute a single tool call and return the data the model should see. */
async function runTool(name: string, input: any, collected: Collected): Promise<unknown> {
  switch (name) {
    case 'search_tutors': {
      const results = await searchTutorsForAI({
        subject: input.subject,
        level: input.level,
        area: input.area,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        minRating: input.minRating,
        teachesInIrish: input.teachesInIrish,
      });
      results.forEach((t) => collected.tutors.set(t.id, t));
      return { count: results.length, tutors: results };
    }
    case 'search_resources': {
      const results = await searchResourcesForAI({
        subject: input.subject,
        level: input.level,
        resourceType: input.resourceType,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
      });
      results.forEach((r) => collected.resources.set(r.id, r));
      return { count: results.length, resources: results };
    }
    case 'get_tutor_availability': {
      const slots = await getTutorAvailabilityForAI(String(input.tutorId));
      return { tutorId: input.tutorId, count: slots.length, slots };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export const aiService = {
  async chat(rawMessages: ChatMessage[], opts: { user?: ChatUser } = {}): Promise<ChatResult> {
    const client = new Anthropic({ apiKey: getApiKey() });
    const messages: Anthropic.MessageParam[] = sanitize(rawMessages).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const collected: Collected = { tutors: new Map(), resources: new Map() };
    const system = buildSystemPrompt(opts.user);
    let reply = '';

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
      });

      const textBlocks = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text);

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );

        // Echo the assistant's tool_use turn back, then answer each tool call.
        messages.push({ role: 'assistant', content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          let data: unknown;
          try {
            data = await runTool(tu.name, tu.input, collected);
          } catch (err: any) {
            data = { error: err?.message || 'Tool failed' };
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(data),
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Plain text answer — we're done.
      reply = textBlocks.join('\n').trim();
      break;
    }

    if (!reply) {
      reply = "Sorry — I couldn't quite work that out. Could you rephrase what you're looking for?";
    }

    return {
      reply,
      tutors: Array.from(collected.tutors.values()),
      resources: Array.from(collected.resources.values()),
    };
  },
};
