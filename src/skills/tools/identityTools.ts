/**
 * Linking an anonymous conversation to an employee record.
 *
 * WhatsApp gives the agent the sender's phone number, so a field worker is
 * identified the moment they write. The web widget passes no identity at all —
 * LuaPop's documented options carry no user, email or token — so a portal
 * visitor is nobody, and every personal request is refused.
 *
 * These two tools close that gap without weakening it. Claiming an employee id
 * proves nothing: ids are guessable and a colleague knows yours. So the code
 * goes to the phone or email ALREADY ON THE RECORD, never to an address given
 * in the conversation. Completing the link therefore requires controlling a
 * channel the employer already associated with that employee.
 */
import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { Channels, User } from 'lua-cli';

import {
  generateLinkCode,
  maskDestination,
  verifyLinkCode,
  LINK_CODE_TTL_MINUTES,
  MAX_LINK_ATTEMPTS,
  type PendingLink,
} from '../../domain/accountLink.js';
import { getHris } from '../../services/bamboohr/index.js';
import { currentEmployee, currentLanguage } from './calculationTools.js';
import type { Language } from '../../domain/types.js';

const say = (language: Language, en: string, ar: string): string => (language === 'ar' ? ar : en);

export class RequestAccountLinkTool implements LuaTool {
  name = 'request_account_link';
  description =
    'Start linking this conversation to an employee record by sending a one-time code to the phone ' +
    'or email already held for that employee. Use when the person is not identified — typically on ' +
    'the web portal — and wants something personal such as their balance, a leave request or their ' +
    'gratuity. Ask for their employee id first.';

  inputSchema = z.object({
    employeeId: z.string().min(2).describe('The employee id the person is claiming, e.g. E-1001.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();

    const already = await currentEmployee();
    if (already) {
      return {
        ok: true,
        alreadyLinked: true,
        employee: { id: already.id, name: already.displayName },
        message: say(
          language,
          `You are already identified as ${already.displayName}. No linking needed.`,
          `أنت معرّف بالفعل باسم ${already.displayName}. لا حاجة للربط.`,
        ),
      };
    }

    const user = await User.get();
    if (!user) {
      return {
        ok: false,
        message: say(
          language,
          'I cannot identify this conversation well enough to link it. Please contact HR.',
          'لا أستطيع تحديد هذه المحادثة بما يكفي لربطها. يُرجى التواصل مع الموارد البشرية.',
        ),
      };
    }

    // Deliberately identical whether or not the id exists: confirming it would
    // let anyone enumerate the workforce, and naming the destination would tell
    // them where a colleague's code lands.
    const acknowledgement = {
      ok: true,
      sent: true,
      expiresInMinutes: LINK_CODE_TTL_MINUTES,
      message: say(
        language,
        `If that employee id exists, I have sent a code to the phone or email on that record. It lasts ${LINK_CODE_TTL_MINUTES} minutes. Tell me the code to finish linking.`,
        `إذا كان رقم الموظف صحيحاً، فقد أرسلت رمزاً إلى الهاتف أو البريد المسجل في السجل، وهو صالح ${LINK_CODE_TTL_MINUTES} دقائق. أخبرني بالرمز لإتمام الربط.`,
      ),
    };

    const employee = await getHris().getEmployee(input.employeeId.trim());
    if (!employee) return acknowledgement;

    // Same routing the leave notifications and the permit sweep use: field
    // staff live on WhatsApp, office staff on email.
    const viaWhatsApp = employee.isFieldWorker && Boolean(employee.mobilePhone);
    const destination = viaWhatsApp ? employee.mobilePhone : employee.workEmail;
    if (!destination) return acknowledgement;

    const code = generateLinkCode();
    await user.update({
      pendingLinkEmployeeId: employee.id,
      pendingLinkCode: code,
      pendingLinkDestination: destination,
      pendingLinkExpiresAt: new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60_000).toISOString(),
      pendingLinkAttempts: 0,
    });

    try {
      await Channels.send({
        channel: viaWhatsApp ? 'whatsapp' : 'email',
        to: viaWhatsApp ? { phoneNumber: destination } : { email: destination },
        text:
          `Rafiq — your verification code is ${code}. It expires in ${LINK_CODE_TTL_MINUTES} minutes. ` +
          `If you did not ask to link your HR account, ignore this and tell HR.\n\n` +
          `رفيق — رمز التحقق الخاص بك هو ${code}، وصالح لمدة ${LINK_CODE_TTL_MINUTES} دقائق. ` +
          `إذا لم تطلب ربط حسابك، تجاهل هذه الرسالة وأبلغ الموارد البشرية.`,
      });
    } catch {
      // The code is stored either way. Saying nothing here keeps a send failure
      // indistinguishable from an id that does not exist.
    }
    return acknowledgement;
  }
}

export class ConfirmAccountLinkTool implements LuaTool {
  name = 'confirm_account_link';
  description =
    'Finish linking this conversation to an employee record using the one-time code that was sent. ' +
    'Use immediately after request_account_link, when the person gives you the code.';

  inputSchema = z.object({
    code: z.string().min(4).describe('The code the employee received, digits only.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<unknown> {
    const language = await currentLanguage();
    const user = await User.get();
    if (!user) {
      return {
        ok: false,
        message: say(
          language,
          'I cannot identify this conversation.',
          'لا أستطيع تحديد هذه المحادثة.',
        ),
      };
    }

    const claimed = user.pendingLinkEmployeeId as string | undefined;
    const pending: PendingLink | null = claimed
      ? {
          employeeId: claimed,
          code: String(user.pendingLinkCode ?? ''),
          expiresAt: String(user.pendingLinkExpiresAt ?? ''),
          attempts: Number(user.pendingLinkAttempts ?? 0),
        }
      : null;

    const verdict = verifyLinkCode(pending, input.code, new Date().toISOString());

    if (!verdict.ok) {
      if (pending && verdict.reason === 'mismatch') {
        await user.update({ pendingLinkAttempts: pending.attempts + 1 });
      }
      const left = pending ? Math.max(0, MAX_LINK_ATTEMPTS - pending.attempts - 1) : 0;
      const wording: Record<string, [string, string]> = {
        no_request: [
          'There is no link in progress. Give me your employee id and I will send a code.',
          'لا يوجد طلب ربط جارٍ. أعطني رقم الموظف وسأرسل رمزاً.',
        ],
        expired: [
          'That code has expired. Give me your employee id again and I will send a new one.',
          'انتهت صلاحية الرمز. أعطني رقم الموظف مرة أخرى وسأرسل رمزاً جديداً.',
        ],
        too_many_attempts: [
          'Too many incorrect codes. For your own protection this request is closed — contact HR to link your account.',
          'محاولات خاطئة كثيرة. لحمايتك تم إغلاق هذا الطلب — يُرجى التواصل مع الموارد البشرية لربط حسابك.',
        ],
        mismatch: [
          `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`,
          `الرمز غير صحيح. تبقى ${left} من المحاولات.`,
        ],
      };
      const pair = wording[verdict.reason] ?? wording.no_request!;
      return {
        ok: false,
        reason: verdict.reason,
        attemptsRemaining: left,
        message: say(language, pair[0], pair[1]),
      };
    }

    const employee = await getHris().getEmployee(verdict.employeeId);
    const destination = String(user.pendingLinkDestination ?? '');
    await user.update({
      employeeId: verdict.employeeId,
      pendingLinkEmployeeId: '',
      pendingLinkCode: '',
      pendingLinkDestination: '',
      pendingLinkExpiresAt: '',
      pendingLinkAttempts: 0,
    });

    const name = employee?.displayName ?? verdict.employeeId;
    return {
      ok: true,
      employee: employee
        ? { id: employee.id, name: employee.displayName, country: employee.country }
        : undefined,
      // Safe to reveal now: they proved they control it.
      codeSentTo: destination ? maskDestination(destination) : undefined,
      message: say(
        language,
        `Linked. I know you as ${name} now, so I can look up your balance, file leave and calculate your end of service.`,
        `تم الربط. أعرفك الآن باسم ${name}، ويمكنني الاطلاع على رصيدك وتقديم طلبات الإجازة وحساب مكافأة نهاية الخدمة.`,
      ),
    };
  }
}

export const identityTools = [new RequestAccountLinkTool(), new ConfirmAccountLinkTool()];
