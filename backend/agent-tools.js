// agent-tools.js

export const toolsRegistry = [
  {
    declaration: {
      name: 'add_commitment',
      description: 'Add a new weekly time commitment',
      parameters: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          hours_per_week: { type: 'NUMBER' },
          type: { type: 'STRING', description: 'study|work|health|personal|sleep' },
          intensity: { type: 'STRING', description: 'low|medium|high' },
          time_slot: { type: 'STRING', description: 'morning|afternoon|evening|late_night|mixed' }
        },
        required: ['title', 'hours_per_week']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('commitments').insert({
        user_id: userId,
        title: String(args.title || 'التزام جديد'),
        hours_per_week: Number(args.hours_per_week || 1),
        type: ['study', 'work', 'health', 'personal', 'sleep'].includes(args.type) ? args.type : 'personal',
        intensity: ['low', 'medium', 'high'].includes(args.intensity) ? args.intensity : 'medium',
        time_slot: ['morning', 'afternoon', 'evening', 'late_night', 'mixed'].includes(args.time_slot) ? args.time_slot : 'mixed',
        flexible: true,
        status: 'active'
      }).select().single();
      if (error) throw error;
      return `added commitment "${data.title}" (${data.hours_per_week}h/week)`;
    }
  },
  {
    declaration: {
      name: 'reduce_hours',
      description: 'Reduce weekly hours of an existing commitment (match by title)',
      parameters: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, new_hours: { type: 'NUMBER' } },
        required: ['title', 'new_hours']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data: row } = await supabase.from('commitments').select('*').eq('user_id', userId).eq('status', 'active').ilike('title', `%${String(args.title || '')}%`).maybeSingle();
      if (!row) return `commitment "${args.title}" not found`;
      const { error } = await supabase.from('commitments').update({ hours_per_week: Number(args.new_hours) }).eq('id', row.id);
      if (error) throw error;
      return `reduced "${row.title}" to ${args.new_hours}h/week`;
    }
  },
  {
    declaration: {
      name: 'archive_commitment',
      description: 'Archive/remove an existing commitment (match by title)',
      parameters: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' } },
        required: ['title']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data: row } = await supabase.from('commitments').select('*').eq('user_id', userId).eq('status', 'active').ilike('title', `%${String(args.title || '')}%`).maybeSingle();
      if (!row) return `commitment "${args.title}" not found`;
      const { error } = await supabase.from('commitments').update({ status: 'archived' }).eq('id', row.id);
      if (error) throw error;
      return `archived "${row.title}"`;
    }
  },
  {
    declaration: {
      name: 'create_goal',
      description: 'Create a strategic goal',
      parameters: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' } },
        required: ['title']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('goals').insert({ user_id: userId, title: String(args.title || 'هدف جديد') }).select().single();
      if (error) throw error;
      return `created goal "${data.title}"`;
    }
  },
  {
    declaration: {
      name: 'add_expense',
      description: 'Record a financial expense or income',
      parameters: {
        type: 'OBJECT',
        properties: { amount: { type: 'NUMBER' }, kind: { type: 'STRING', description: 'expense|income' }, category: { type: 'STRING' } },
        required: ['amount']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('finance_entries').insert({ user_id: userId, type: args.kind === 'income' ? 'income' : 'expense', amount: Number(args.amount || 0), category: String(args.category || 'عام') }).select().single();
      if (error) throw error;
      return `recorded ${args.kind === 'income' ? 'income' : 'expense'} of ${args.amount} (${args.category || 'عام'})`;
    }
  },
  {
    declaration: {
      name: 'add_home_task',
      description: 'Add a home task',
      parameters: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, priority: { type: 'STRING', description: 'low|medium|high|urgent' } },
        required: ['title']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('home_tasks').insert({ user_id: userId, title: String(args.title || 'مهمة'), priority: String(args.priority || 'medium') }).select().single();
      if (error) throw error;
      return `added home task "${args.title}"`;
    }
  },
  {
    declaration: {
      name: 'log_study',
      description: 'Log a study session',
      parameters: {
        type: 'OBJECT',
        properties: { subject: { type: 'STRING' }, duration_minutes: { type: 'NUMBER' } },
        required: ['subject', 'duration_minutes']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data, error } = await supabase.from('study_sessions').insert({ user_id: userId, subject: String(args.subject || 'دراسة'), duration_minutes: Number(args.duration_minutes || 0) }).select().single();
      if (error) throw error;
      return `logged ${args.duration_minutes}min study of "${args.subject}"`;
    }
  },
  {
    declaration: {
      name: 'mark_contact',
      description: 'Mark that the user contacted a person today',
      parameters: {
        type: 'OBJECT',
        properties: { person_name: { type: 'STRING' } },
        required: ['person_name']
      }
    },
    execute: async (userId, args, { supabase }) => {
      const { data: row } = await supabase.from('relationships').select('id').eq('user_id', userId).ilike('person_name', `%${String(args.person_name || '')}%`).maybeSingle();
      if (!row) return `person "${args.person_name}" not found in relationships`;
      const { error } = await supabase.from('relationships').update({ last_contact: new Date().toISOString().slice(0, 10) }).eq('id', row.id);
      if (error) throw error;
      return `marked contact with "${args.person_name}" today`;
    }
  }
];

export const AGENT_TOOLS = toolsRegistry.map(t => t.declaration);

export const getGroqTools = () => toolsRegistry.map(tool => ({
  type: 'function',
  function: {
    name: tool.declaration.name,
    description: tool.declaration.description,
    parameters: {
      type: 'object',
      properties: tool.declaration.parameters.properties,
      required: tool.declaration.parameters.required || [],
    },
  },
}));

export const runAgentTool = async (userId, name, args, context) => {
  const tool = toolsRegistry.find(t => t.declaration.name === name);
  if (!tool) {
    console.warn(`Tool ${name} called but not found.`);
    return `unknown tool ${name}`;
  }
  try {
    return await tool.execute(userId, args, context);
  } catch (e) {
    console.error(`Error executing ${name}:`, e.message);
    return `tool ${name} failed: ${e.message}`;
  }
};