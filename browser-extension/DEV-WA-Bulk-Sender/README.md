# DEV WA Bulk Sender — Setup Guide

## Install (ek baar)
1. ZIP ko extract karo (jaise `D:\DEV-WA-Bulk`)
2. Chrome me `chrome://extensions` kholo
3. Upar right me **Developer mode** ON karo
4. **Load unpacked** dabao, phir extract kiya hua folder select karo
5. Puzzle 🧩 icon par jaake **DEV WA Bulk Sender** ko pin kar do

## Use kaise kare
1. Chrome me **web.whatsapp.com** kholo aur login rakho (QR scan)
2. Extension icon dabao. Dashboard khulega
3. **Contact list:** `Sample_Contacts.xlsx` jaisa Excel upload karo (Phone, Name, aur koi bhi column)
4. **Message:** `{Name}`, `{Firm}` jaise placeholders likho. Preview me check karo
5. **Images (optional):** ek ya zyada images select karo. Message pehli image ka caption banega
6. **Start** dabao. WhatsApp tab apne aap ek-ek chat kholke bhejega
7. Report table live update hogi. **Report Excel** se download karo

## Dhyan rakho
- **Pehli baar 2-3 apne numbers ki list se test karo.**
- Sending ke time WhatsApp tab me kuch click/type mat karo. Dusra kaam dusre tab ya window me karo.
- Laptop sleep me na jaye.
- Delay 25–60 sec aur daily limit ~150 rakho. Number ban ka risk kam rahega.
- Jo number WhatsApp par nahi hai, woh "Failed" me aayega. **Failed wale dobara** se retry kar sakte ho.
- Pause/Stop ke baad **Resume** wahi se shuru karega.
- WhatsApp apna design badle aur kuch kaam karna band ho jaye, to `content.js` ke selectors update karne padenge.

## DEV OMS se bhejna (v2.1)
- Extension DEV OMS (localhost:3000 aur dev-two-gilt.vercel.app) se jud jata hai, alag se kuch set nahi karna.
- **Courier Tracking:** Run Now → parcels select karo → **Send WhatsApp**. Messages is extension ki queue me jaate hai.
- **Orders → Send DC WhatsApp:** har institute ki Delivery Challan PDF document ke roop me jaati hai.
- Ek tab me web.whatsapp.com login rakho. Sent/Failed status OMS me apne aap update hota hai, jab koi bhi OMS page khula ho.
- Extension update karne ke baad `chrome://extensions` me **Reload** dabao aur OMS + WhatsApp dono tab refresh karo.

## Quick Docs (v2.2)
- Extension icon → popup → **⚙ Quick Docs Settings**. Yahan firm-wise PDF add karo: label, firm, caption (`{firm}`, `{date}`, `{contact_name}`), colour, shortcut.
- WhatsApp Web me right side **📄 Quick Docs** panel aata hai. Upar "Sending to: …" naam check karo, phir button dabao (ya Alt+1…9).
- **Direct Send** = turant chala jata hai. **Attach Only** = PDF + caption lag jata hai, Send aap dabao.
- **👥 Multi Send** = kai contacts ko docs (Dashboard ki list ya paste kiye numbers). Pause/Stop/Retry hai.
- **Export backup** se dusre PC par same setup **Import** karo.
- Kuch attach na ho to `quickdoc/selectors.js` ke selectors update karo (Console me `[QuickDoc]` dekho).
