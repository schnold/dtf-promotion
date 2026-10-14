import type { APIRoute } from 'astro';
import { isAdminRequest, isSameOriginPost, unauthorizedResponse } from '../../../lib/basic-auth';
import { saveSiteSettings, SettingsValidationError, settingsFromForm } from '../../../lib/settings';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  if (!isAdminRequest(request)) return unauthorizedResponse();
  if (!isSameOriginPost(request)) return new Response('Ungültige Anfragequelle.', { status: 403 });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return new Response('Anfrage ist zu groß.', { status: 413 });
  }

  try {
    const settings = settingsFromForm(await request.formData());
    await saveSiteSettings(settings);
    return redirect('/admin?saved=1', 303);
  } catch (error) {
    if (!(error instanceof SettingsValidationError)) {
      console.error('Settings could not be saved.', error);
    }
    const message = error instanceof SettingsValidationError
      ? error.message
      : 'Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.';
    return redirect(`/admin?error=${encodeURIComponent(message)}`, 303);
  }
};

export const ALL: APIRoute = () => new Response('Method Not Allowed', {
  status: 405,
  headers: { Allow: 'POST' },
});
