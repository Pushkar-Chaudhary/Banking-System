const nodemailer = require('nodemailer');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTransporter() {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const refreshToken = process.env.REFRESH_TOKEN;
  const smtpHost = process.env.SMTP_HOST;

  // 1. Custom SMTP Server (Host & Port)
  if (smtpHost) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || emailUser,
        pass: process.env.SMTP_PASS || emailPass,
      },
    });
  }

  // 2. Gmail / Standard Service with App Password
  if (emailUser && emailPass) {
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });
  }

  // 3. Gmail OAuth2
  if (emailUser && clientId && clientSecret && refreshToken) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: emailUser,
        clientId,
        clientSecret,
        refreshToken,
      },
    });
  }

  return null;
}

const sendEmail = async (to, subject, text, html) => {
  const fromAddress = process.env.EMAIL_FROM || `"Sajilo Pasal" <${process.env.EMAIL_USER || 'no-reply@sajilopasal.com'}>`;
  const transporter = getTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email transport is not configured for production');
    }
    console.warn(`[EMAIL NOTICE] No email transport configured in environment. Simulation email to <${to}>:`);
    console.warn(`Subject: ${subject}`);
    console.warn(`Body: ${text}`);
    return { messageId: 'simulated-dev-id', simulated: true };
  }

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text,
      html,
    });
    console.log('Email successfully sent to', to, 'ID:', info.messageId);
    return info;
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error.message);
    throw error;
  }
};

async function sendRegistrationOtpEmail(userEmail, name, otp) {
  const subject = `Your Sajilo Pasal Verification Code: ${otp}`;
  const text = `Hello ${name || 'there'},\n\nYour verification code for registering on Sajilo Pasal is:\n\n${otp}\n\nThis code will expire in 10 minutes.\nIf you did not request this code, please ignore this email.\n\nWarm regards,\nThe Sajilo Pasal Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #faf8f5; border: 1px solid #e7dfd5; border-radius: 12px; color: #2c2523;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #b45309; text-transform: uppercase;">SAJILO PASAL</span>
        <h2 style="font-size: 24px; margin: 8px 0 0 0; color: #1c1917;">Account Verification Code</h2>
      </div>
      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 20px;">Hello <strong>${escapeHtml(name || 'there')}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px;">Thank you for registering with Sajilo Pasal. Please use the one-time verification code below to complete your registration:</p>
      <div style="text-align: center; margin: 32px 0;">
        <div style="display: inline-block; background: #ffffff; border: 2px dashed #b45309; border-radius: 8px; padding: 18px 36px;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1c1917;">${otp}</span>
        </div>
        <p style="font-size: 13px; color: #78716c; margin-top: 10px;">Valid for 10 minutes</p>
      </div>
      <p style="font-size: 14px; line-height: 1.5; color: #57534e; margin-bottom: 28px;">If you did not attempt to sign up for Sajilo Pasal, please safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #e7dfd5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #a8a29e; text-align: center; margin: 0;">&copy; ${new Date().getFullYear()} Sajilo Pasal. Empowering local businesses across Nepal.</p>
    </div>
  `;

  return sendEmail(userEmail, subject, text, html);
}

async function sendRegistrationEmail(userEmail, name) {
  const subject = 'Welcome to Sajilo Pasal!';
  const text = `Hello ${name},\n\nWelcome to Sajilo Pasal! Your account has been successfully verified and registered.\n\nExplore local products or grow your business with us.\n\nBest regards,\nThe Sajilo Pasal Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #faf8f5; border: 1px solid #e7dfd5; border-radius: 12px; color: #2c2523;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #b45309; text-transform: uppercase;">SAJILO PASAL</span>
        <h2 style="font-size: 24px; margin: 8px 0 0 0; color: #1c1917;">Welcome to Sajilo Pasal!</h2>
      </div>
      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 16px;">Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 20px;">We're thrilled to welcome you to the Sajilo Pasal community. Your account is now active and ready to go.</p>
      <div style="background: #ffffff; border-radius: 8px; padding: 20px; border: 1px solid #e7dfd5; margin-bottom: 24px;">
        <p style="margin: 0 0 8px 0; font-weight: 600;">Here is what you can do:</p>
        <ul style="margin: 0; padding-left: 20px; color: #57534e; line-height: 1.6;">
          <li>Browse authentic products from local sellers across Nepal</li>
          <li>Pay seamlessly with eSewa or Cash on Delivery</li>
          <li>Track your orders and delivery status in real-time</li>
        </ul>
      </div>
      <hr style="border: none; border-top: 1px solid #e7dfd5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #a8a29e; text-align: center; margin: 0;">&copy; ${new Date().getFullYear()} Sajilo Pasal. All rights reserved.</p>
    </div>
  `;

  return sendEmail(userEmail, subject, text, html);
}

async function sendOrderConfirmationToBuyer({ buyerEmail, buyerName, orders, shippingAddress, paymentMethod, checkoutTotal }) {
  const orderCount = Array.isArray(orders) ? orders.length : 1;
  const orderList = Array.isArray(orders) ? orders : [orders];
  const orderCode = orderList[0]?._id?.toString().slice(-8).toUpperCase() || 'ORDER';

  const subject = `Order Confirmation #${orderCode} - Sajilo Pasal`;

  const itemsRows = orderList.flatMap((ord) => ord.items || []).map((item) => `
    <tr>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee;">${escapeHtml(item.productName)}</td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: right;">NPR ${(item.price || 0).toLocaleString()}</td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">NPR ${(item.subtotal || 0).toLocaleString()}</td>
    </tr>
  `).join('');

  const totalShipping = orderList.reduce((sum, ord) => sum + (ord.shippingCost || 0), 0);
  const formattedMethod = paymentMethod === 'esewa' ? 'eSewa Online Payment' : 'Cash on Delivery (COD)';
  const safeAddress = {
    fullName: escapeHtml(shippingAddress?.fullName),
    phone: escapeHtml(shippingAddress?.phone),
    addressLine1: escapeHtml(shippingAddress?.addressLine1),
    addressLine2: escapeHtml(shippingAddress?.addressLine2),
    city: escapeHtml(shippingAddress?.city),
    state: escapeHtml(shippingAddress?.state),
    country: escapeHtml(shippingAddress?.country || 'Nepal')
  };

  const text = `Hello ${buyerName},\n\nThank you for your order! Your order #${orderCode} (${orderCount} shipment(s)) totaling NPR ${checkoutTotal.toLocaleString()} has been placed.\n\nPayment Method: ${formattedMethod}\nDelivery to: ${shippingAddress?.fullName}, ${shippingAddress?.addressLine1}, ${shippingAddress?.city}, ${shippingAddress?.state}\n\nWe will notify you once items are dispatched.\n\nBest regards,\nSajilo Pasal`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #faf8f5; border: 1px solid #e7dfd5; border-radius: 12px; color: #2c2523;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #b45309; text-transform: uppercase;">SAJILO PASAL</span>
        <h2 style="font-size: 24px; margin: 8px 0 0 0; color: #1c1917;">Order Confirmation</h2>
        <p style="color: #78716c; font-size: 14px; margin-top: 4px;">Reference #${orderCode}</p>
      </div>

      <p style="font-size: 15px; line-height: 1.6;">Hello <strong>${escapeHtml(buyerName)}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6;">Thank you for shopping with us! We have received your order.</p>

      <div style="background: #ffffff; border-radius: 8px; border: 1px solid #e7dfd5; overflow: hidden; margin: 20px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f5f2eb; color: #44403c;">
              <th style="padding: 10px 8px; text-align: left;">Item</th>
              <th style="padding: 10px 8px; text-align: center;">Qty</th>
              <th style="padding: 10px 8px; text-align: right;">Price</th>
              <th style="padding: 10px 8px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
        <div style="padding: 16px; background: #faf8f5; border-top: 1px solid #e7dfd5; font-size: 14px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span>Delivery / Shipping:</span>
            <span>NPR ${totalShipping.toLocaleString()}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 16px; color: #1c1917; border-top: 1px solid #e7dfd5; padding-top: 8px;">
            <span>Grand Total:</span>
            <span style="color: #b45309;">NPR ${checkoutTotal.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div style="background: #ffffff; border-radius: 8px; padding: 16px; border: 1px solid #e7dfd5; margin-bottom: 20px; font-size: 14px;">
        <p style="margin: 0 0 8px 0; font-weight: 700; color: #1c1917;">Shipping Address:</p>
        <p style="margin: 0; color: #57534e; line-height: 1.5;">
          ${safeAddress.fullName}<br/>
          ${safeAddress.phone}<br/>
          ${safeAddress.addressLine1}${safeAddress.addressLine2 ? ', ' + safeAddress.addressLine2 : ''}<br/>
          ${safeAddress.city}, ${safeAddress.state}, ${safeAddress.country}
        </p>
        <p style="margin: 12px 0 0 0; font-weight: 600; color: #1c1917;">Payment Method: <span style="font-weight: 400; color: #57534e;">${formattedMethod}</span></p>
      </div>

      <hr style="border: none; border-top: 1px solid #e7dfd5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #a8a29e; text-align: center; margin: 0;">&copy; ${new Date().getFullYear()} Sajilo Pasal. Happy shopping!</p>
    </div>
  `;

  return sendEmail(buyerEmail, subject, text, html);
}

async function sendOrderNotificationToSeller({ sellerEmail, sellerName, order, sellerItems, buyerInfo, shippingAddress }) {
  const orderCode = order._id?.toString().slice(-8).toUpperCase() || 'ORDER';
  const subject = `New Order #${orderCode} Received! - Sajilo Pasal`;

  const items = sellerItems || order.items || [];
  const itemsRows = items.map((item) => `
    <tr>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee;">${escapeHtml(item.productName)}</td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: right;">NPR ${(item.price || 0).toLocaleString()}</td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">NPR ${(item.subtotal || 0).toLocaleString()}</td>
    </tr>
  `).join('');

  const sellerTotal = items.reduce((sum, item) => sum + (item.subtotal || 0), 0) + (order.shippingCost || 0);
  const formattedMethod = order.paymentMethod === 'esewa' ? 'eSewa Online Payment' : 'Cash on Delivery (COD)';
  const safeCustomer = {
    name: escapeHtml(buyerInfo?.name || shippingAddress?.fullName || 'Customer'),
    phone: escapeHtml(shippingAddress?.phone || buyerInfo?.phone || 'N/A'),
    email: escapeHtml(buyerInfo?.email || 'N/A'),
    addressLine1: escapeHtml(shippingAddress?.addressLine1),
    addressLine2: escapeHtml(shippingAddress?.addressLine2),
    city: escapeHtml(shippingAddress?.city),
    state: escapeHtml(shippingAddress?.state),
    country: escapeHtml(shippingAddress?.country || 'Nepal')
  };

  const text = `Hello ${sellerName},\n\nYou have received a new order #${orderCode} on Sajilo Pasal!\n\nCustomer Details:\nName: ${buyerInfo?.name || shippingAddress?.fullName}\nPhone: ${shippingAddress?.phone || buyerInfo?.phone || 'N/A'}\nEmail: ${buyerInfo?.email || 'N/A'}\nDelivery Address: ${shippingAddress?.addressLine1}, ${shippingAddress?.city}, ${shippingAddress?.state}\n\nItems:\n${items.map(i => `- ${i.productName} x ${i.quantity} (NPR ${i.subtotal})`).join('\n')}\n\nTotal: NPR ${sellerTotal.toLocaleString()}\nPayment: ${formattedMethod} (${order.paymentStatus})\n\nPlease visit your Seller Studio to manage fulfillment.\n\nBest regards,\nSajilo Pasal Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #faf8f5; border: 1px solid #e7dfd5; border-radius: 12px; color: #2c2523;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #b45309; text-transform: uppercase;">SAJILO PASAL · SELLER STUDIO</span>
        <h2 style="font-size: 24px; margin: 8px 0 0 0; color: #1c1917;">You Have a New Order!</h2>
        <p style="color: #78716c; font-size: 14px; margin-top: 4px;">Order #${orderCode}</p>
      </div>

      <p style="font-size: 15px; line-height: 1.6;">Hello <strong>${escapeHtml(sellerName)}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6;">A customer has placed an order containing your products. Here is the complete order information:</p>

      <div style="background: #ffffff; border-radius: 8px; padding: 16px; border: 1px solid #e7dfd5; margin: 20px 0; font-size: 14px;">
        <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #1c1917; border-bottom: 1px solid #eee; padding-bottom: 6px;">Customer & Delivery Information</h3>
        <p style="margin: 4px 0;"><strong>Customer Name:</strong> ${safeCustomer.name}</p>
        <p style="margin: 4px 0;"><strong>Customer Phone:</strong> <a href="tel:${safeCustomer.phone}" style="color: #b45309; text-decoration: none;">${safeCustomer.phone}</a></p>
        <p style="margin: 4px 0;"><strong>Customer Email:</strong> ${safeCustomer.email}</p>
        <p style="margin: 4px 0;"><strong>Delivery Address:</strong> ${safeCustomer.addressLine1}${safeCustomer.addressLine2 ? ', ' + safeCustomer.addressLine2 : ''}, ${safeCustomer.city}, ${safeCustomer.state}, ${safeCustomer.country}</p>
        <p style="margin: 8px 0 0 0;"><strong>Payment Method:</strong> ${formattedMethod} (${order.paymentStatus})</p>
      </div>

      <div style="background: #ffffff; border-radius: 8px; border: 1px solid #e7dfd5; overflow: hidden; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f5f2eb; color: #44403c;">
              <th style="padding: 10px 8px; text-align: left;">Product</th>
              <th style="padding: 10px 8px; text-align: center;">Qty</th>
              <th style="padding: 10px 8px; text-align: right;">Unit Price</th>
              <th style="padding: 10px 8px; text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
        <div style="padding: 16px; background: #faf8f5; border-top: 1px solid #e7dfd5; font-size: 14px;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 16px; color: #1c1917;">
            <span>Seller Order Total:</span>
            <span style="color: #b45309;">NPR ${sellerTotal.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div style="text-align: center; margin: 28px 0 16px 0;">
        <p style="font-size: 14px; color: #57534e; margin-bottom: 12px;">Please log in to your Seller Studio to update the fulfillment status as you process and ship this order.</p>
      </div>

      <hr style="border: none; border-top: 1px solid #e7dfd5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #a8a29e; text-align: center; margin: 0;">&copy; ${new Date().getFullYear()} Sajilo Pasal Seller Central.</p>
    </div>
  `;

  return sendEmail(sellerEmail, subject, text, html);
}

async function sendPasswordResetOtpEmail(userEmail, name, otp) {
  const subject = `Your Sajilo Pasal password reset code: ${otp}`;
  const text = `Hello ${name || 'there'},\n\nWe received a request to reset your Sajilo Pasal password.\n\nYour password reset code is:\n\n${otp}\n\nThis code will expire in 10 minutes. If you did not request a password reset, you can safely ignore this email.\n\nWarm regards,\nThe Sajilo Pasal Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #faf8f5; border: 1px solid #e7dfd5; border-radius: 12px; color: #2c2523;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #b45309; text-transform: uppercase;">SAJILO PASAL</span>
        <h2 style="font-size: 24px; margin: 8px 0 0 0; color: #1c1917;">Reset Your Password</h2>
      </div>
      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 20px;">Hello <strong>${escapeHtml(name || 'there')}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6; margin-bottom: 24px;">We received a request to reset your Sajilo Pasal password. Enter this code on the reset page to choose a new password:</p>
      <div style="text-align: center; margin: 32px 0;">
        <div style="display: inline-block; background: #ffffff; border: 2px dashed #b45309; border-radius: 8px; padding: 18px 36px;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1c1917;">${otp}</span>
        </div>
        <p style="font-size: 13px; color: #78716c; margin-top: 10px;">Valid for 10 minutes</p>
      </div>
      <p style="font-size: 14px; line-height: 1.5; color: #57534e; margin-bottom: 28px;">If you did not request a password reset, no action is needed — your password stays unchanged.</p>
      <hr style="border: none; border-top: 1px solid #e7dfd5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #a8a29e; text-align: center; margin: 0;">&copy; ${new Date().getFullYear()} Sajilo Pasal. Empowering local businesses across Nepal.</p>
    </div>
  `;

  return sendEmail(userEmail, subject, text, html);
}

module.exports = {
  sendEmail,
  sendRegistrationOtpEmail,
  sendRegistrationEmail,
  sendPasswordResetOtpEmail,
  sendOrderConfirmationToBuyer,
  sendOrderNotificationToSeller
};