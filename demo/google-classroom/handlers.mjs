/**
 * Classroom demo — action handlers (clone → mutate → bump → store → push).
 * Mirrors the multiversal makeMvaHandlers pattern.
 */

export function makeGcHandlers({ bump, storeManifest, pushEvent, AppError }) {
  const mutate = (ctx, fn) => {
    const next = structuredClone(ctx.manifest);
    fn(next);
    next.page.version = bump(next.page.version);
    storeManifest(next);
    pushEvent(next.page.url, next, null);
    return { type: 'full', manifest: next };
  };

  const on = (v) => v === true || v === 'true' || v === 'on';

  return {
    join_class: async (ctx) =>
      mutate(ctx, (next) => {
        const code = String(ctx.params.class_code ?? '').toUpperCase();
        const known = { X4K7P9: 'Art & Design', M2T8QR: 'Geography' };
        const name = known[code];
        if (!name)
          throw new AppError('app.err.validation.param_value', {
            message: `Class code ${code} not found — ask your teacher to check it`,
          });
        if (next.state.classes.value.some((c) => c.value?.name?.value === name))
          throw new AppError('app.err.validation.param_value', {
            message: `You're already enrolled in ${name}`,
          });
        next.state.classes.value.push({
          type: 'object',
          value: {
            id: { type: 'string', value: `c-${code.toLowerCase()}` },
            name: { type: 'string', value: name, label: 'Class' },
            section: { type: 'string', value: 'Period 6', label: 'Section' },
            teacher: { type: 'string', value: 'Ms Okafor', label: 'Teacher' },
            room: { type: 'string', value: 'Studio 2', label: 'Room' },
            next_due: { type: 'string', value: 'Intro brief - next Tue', label: 'Next due' },
          },
          label: name,
        });
      }),

    comment: async (ctx) =>
      mutate(ctx, (next) => {
        const text = String(ctx.params.text ?? '').trim();
        if (!text)
          throw new AppError('app.err.validation.param_value', {
            message: 'Comment cannot be empty',
          });
        const posts = next.state.posts?.value ?? [];
        posts.unshift({
          type: 'object',
          value: {
            author: { type: 'string', value: 'Ada Osei', label: 'Author' },
            role: { type: 'string', value: 'student', label: 'Role' },
            posted: { type: 'datetime', value: new Date().toISOString(), label: 'Posted' },
            text: { type: 'string', value: text, label: 'Comment' },
          },
          label: 'Class comment',
        });
        next.state.posts.value = posts;
      }),

    submit_work: async (ctx) =>
      mutate(ctx, (next) => {
        if (next.state.item?.value?.status) next.state.item.value.status.value = 'turned_in';
        const work = next.state.your_work?.value;
        if (work) {
          const c = String(ctx.params.private_comment ?? '');
          if (work.private_comment) work.private_comment.value = c;
          work.turned_in_at = {
            type: 'datetime',
            value: new Date().toISOString(),
            label: 'Turned in',
          };
        }
      }),

    attach_file: async (ctx) =>
      mutate(ctx, (next) => {
        const f = ctx.params.file;
        const name = typeof f === 'object' ? (f.name ?? 'attachment.pdf') : 'attachment.pdf';
        const list = next.state.your_work?.value?.attachments;
        if (list?.value?.push) {
          list.value.push({
            type: 'file',
            value: { url: '#', name, mime: 'application/pdf' },
          });
        }
      }),

    toggle_notify: async (ctx) =>
      mutate(ctx, (next) => {
        const s = next.state.settings.value;
        for (const k of Object.keys(s)) {
          if (k !== 'saved' && s[k]?.type === 'boolean') s[k].value = on(ctx.params[k]);
        }
        s.saved = {
          type: 'string',
          value: `Saved — reminders ${on(ctx.params.email_due_reminders) ? 'on' : 'off'}, grades ${on(ctx.params.email_returned_grades) ? 'on' : 'off'}, comments ${on(ctx.params.email_comments) ? 'on' : 'off'}, push ${on(ctx.params.push_everything) ? 'on' : 'off'}.`,
          label: 'Status',
        };
      }),
  };
}
