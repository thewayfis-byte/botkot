function initChat(orderId) {
  const socket = io();
  socket.emit('join-chat', orderId);

  const messages = document.getElementById('chat-messages');
  const form = document.getElementById('message-form');
  const input = document.getElementById('message-input');
  const closeBtn = document.getElementById('close-chat');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) {
      socket.emit('send-message', { orderId, text });
      input.value = '';
    }
  });

  socket.on('new-message', (msg) => {
    const div = document.createElement('div');
    div.className = `message ${msg.sender === 'admin' ? 'text-end' : ''}`;
    div.innerHTML = `
      <div class="badge ${msg.sender === 'admin' ? 'bg-blue' : 'bg-azure'}">${msg.text}</div>
      <small class="text-muted">${msg.time}</small>
      <hr>
    `;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  });

  closeBtn.addEventListener('click', () => {
    if (confirm('Закрыть заказ?')) {
      socket.emit('close-chat', orderId);
      window.location.href = '/admin';
    }
  });

  socket.on('chat-closed', () => {
    alert('Чат закрыт');
    window.location.href = '/admin';
  });
}