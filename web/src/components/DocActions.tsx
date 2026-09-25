import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, MessageCircle, Printer, Receipt } from 'lucide-react';
import { api, download, errorMessage, openPdf } from '@/lib/api';
import { useToast } from '@/app/providers';
import { Modal } from './ui/overlay';
import { TextArea, TextInput } from './ui/form';
import { Menu, type MenuAction } from './ui/overlay';

/**
 * Print / PDF / WhatsApp for a document. Printing uses the dedicated server-rendered layouts
 * (A4 tax invoice, 80/58 mm thermal, receipt) — never a screenshot of the web page.
 */
export function useDocActions(base: string, name: string, opts: { thermal?: boolean; whatsappQuery?: string } = {}) {
  const toast = useToast();
  const [waOpen, setWaOpen] = useState(false);
  const run = (fn: () => Promise<unknown>) => fn().catch(e => toast.error('Could not open the document', errorMessage(e)));
  const actions: MenuAction[] = [
    { label: 'Print A4', icon: <Printer />, onClick: () => run(() => openPdf(`${base}/pdf`)) },
    { label: 'Print thermal receipt', icon: <Receipt />, onClick: () => run(() => openPdf(`${base}/pdf?format=thermal`)), hidden: !opts.thermal },
    { label: 'Download PDF', icon: <Download />, onClick: () => run(() => download('GET', `${base}/pdf?download=true`, `${name}.pdf`)) },
    { label: 'Send on WhatsApp', icon: <MessageCircle />, onClick: () => setWaOpen(true) },
  ];
  const dialog = <WhatsAppDialog open={waOpen} onClose={() => setWaOpen(false)} url={`${base}/whatsapp${opts.whatsappQuery ?? ''}`} pdfUrl={`${base}/pdf?download=true`} pdfName={`${name}.pdf`} />;
  return { actions, dialog, print: () => run(() => openPdf(`${base}/pdf`)), printThermal: () => run(() => openPdf(`${base}/pdf?format=thermal`)), whatsapp: () => setWaOpen(true) };
}

export function DocActionsButtons({ base, name, thermal, primary }: { base: string; name: string; thermal?: boolean; primary?: boolean }) {
  const d = useDocActions(base, name, { thermal });
  return (
    <>
      <button className={`btn${primary ? ' btn-primary' : ''}`} onClick={d.print}><Printer aria-hidden />Print</button>
      <button className="btn" onClick={d.whatsapp}><MessageCircle aria-hidden />WhatsApp</button>
      <Menu items={d.actions} label="More document actions" />
      {d.dialog}
    </>
  );
}

/** Opens WhatsApp with an editable, template-based message. Nothing is sent automatically. */
export function WhatsAppDialog({ open, onClose, url, pdfUrl, pdfName }: { open: boolean; onClose: () => void; url: string; pdfUrl?: string; pdfName?: string }) {
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['wa', url], queryFn: () => api.get<{ mobile?: string; message: string; link: string }>(url), enabled: open, staleTime: 0 });
  const [mobile, setMobile] = useState<string>();
  const [message, setMessage] = useState<string>();
  const m = mobile ?? data?.mobile ?? '';
  const msg = message ?? data?.message ?? '';
  const link = `https://wa.me/${m.replace(/\D/g, '').replace(/^(?!91)(\d{10})$/, '91$1')}?text=${encodeURIComponent(msg)}`;
  const close = () => { setMobile(undefined); setMessage(undefined); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Send on WhatsApp" width={520}
      footer={<>
        {pdfUrl && <button className="btn" onClick={() => download('GET', pdfUrl, pdfName ?? 'document.pdf').catch(e => toast.error('Download failed', errorMessage(e)))}><Download aria-hidden />Save PDF to attach</button>}
        <a className={`btn btn-primary${!m || !msg ? ' disabled' : ''}`} href={link} target="_blank" rel="noopener noreferrer" onClick={() => { if (m && msg) close(); }} aria-disabled={!m || !msg}>
          <ExternalLink aria-hidden />Open WhatsApp
        </a>
      </>}>
      {isLoading ? <p className="muted">Preparing message…</p> : error ? <p className="t-bad">{errorMessage(error)}</p> : (
        <div className="stack gap-4">
          <TextInput label="Mobile number" value={m} onChange={e => setMobile(e.target.value)} inputMode="tel" hint="10-digit Indian mobile; +91 is added automatically." />
          <TextArea label="Message" value={msg} onChange={e => setMessage(e.target.value)} rows={8} hint="From your WhatsApp template in Settings. Edit before sending if needed." />
        </div>
      )}
    </Modal>
  );
}
