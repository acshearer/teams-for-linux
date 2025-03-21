/**
 * @type {Array<{handler:(data)=>void,event:string,handle:number}>}
 */
const eventHandlers = [];

// Supported events
const supportedEvents = [
	'call-connected',
	'call-disconnected',
	'activities-count-updated',
	'meeting-started'
];

class ActivityHub {
	constructor() {
	}

	/**
	 * @param {'call-connected'|'call-disconnected'|'activities-count-updated'|'meeting-started'} event 
	 * @param {(data)=>void} handler
	 * @returns {number} handle 
	 */
	on(event, handler) {
		return addEventHandler(event, handler);
	}

	/**
	 * @param {'call-connected'|'call-disconnected'|'activities-count-updated'|'meeting-started'} event 
	 * @param {number} handle
	 * @returns {number} handle 
	 */
	off(event, handle) {
		return removeEventHandler(event, handle);
	}

	start() {
		whenControllerReady(assignEventHandlers);
	}

	setDefaultTitle(title) {
		whenControllerReady(controller => {
			controller.pageTitleDefault = title;
		});
	}
}

function isSupportedEvent(event) {
	return supportedEvents.some(e => {
		return e === event;
	});
}

function isFunction(func) {
	return typeof (func) === 'function';
}

function getHandleIndex(event, handle) {
	return eventHandlers.findIndex(h => {
		return h.event === event && h.handle === handle;
	});
}

function addEventHandler(event, handler) {
	let handle;
	if (isSupportedEvent(event) && isFunction(handler)) {
		handle = Math.ceil(Math.random() * 100000);
		eventHandlers.push({
			event: event,
			handle: handle,
			handler: handler
		});
	}
	return handle;
}

function removeEventHandler(event, handle) {
	const handlerIndex = getHandleIndex(event, handle);
	if (handlerIndex > -1) {
		eventHandlers[handlerIndex].handler = null;
		eventHandlers.splice(handlerIndex, 1);
		return handle;
	}

	return null;
}

/**
 * 
 * @param {'call-connected'|'call-disconnected'|'activities-count-updated'|'meeting-started'} event 
 * @returns {Array<{handler:(data)=>void,event:string,handle:number}>} handlers
 */
function getEventHandlers(event) {
	return eventHandlers.filter(e => {
		return e.event === event;
	});
}

/**
 * @param {(controller)=>void} callback 
 */
function whenControllerReady(callback) {
	const controller = typeof window.angular !== 'undefined' ? window.angular.element(document.documentElement).controller() : null;
	if (controller) {
		callback(controller);
	} else {
		setTimeout(() => whenControllerReady(callback), 4000);
	}
}

function assignEventHandlers(controller) {
	assignActivitiesCountUpdateHandler(controller);
	assignCallConnectedHandler(controller);
	assignCallDisconnectedHandler(controller);
	assignWorkerMessagingUpdatesHandler(controller);
}

/**
 * @param {'*'} data 
 * @returns {Array<object>}
 */
function getMeetingEvents(data) {
	return data.filter(d => {
		return d.messagetype === 'Event/Call' && d.content === '<partlist alt =""></partlist>';
	});
}

async function getActiveCaledarEvents(controller) {
	await refreshCalendarEvents(controller);
	const calendarEvents = controller.calendarService.getCachedEvents();
	const rightNow = new Date();
	return calendarEvents.filter(ce => {
		return new Date(ce.endTime) - rightNow > 0;
	});
}


async function refreshCalendarEvents(controller) {
	const c = controller.calendarService.refreshCalendarEvents();
	do {
		await new Promise(r => setTimeout(r, 1000));
	} while (c.$$state.status == 0);
	return c.$$state.status;
}


//conversationLink
async function getActiveMeetingEvents(controller, data) {
	const workerEvents = getMeetingEvents(data);
	if (workerEvents.length > 0) {
		/**
		 * @type {Array<object>}
		 */
		const calendarEvents = await getActiveCaledarEvents(controller);
		return getMeetingNotificationList(workerEvents, calendarEvents);
	} else {
		return [];
	}
}

function getMeetingNotificationList(workerEvents, calendarEvents) {
	const notificationList = [];
	for (const we of workerEvents) {
		const meetingId = we.conversationLink.split('/')[1].split(';')[0];
		addEligibleCalendarEvents(calendarEvents, meetingId, notificationList);
	}
	return notificationList;
}

function addEligibleCalendarEvents(calendarEvents, meetingId, notificationList) {
	for (const ce of calendarEvents) {
		if (JSON.parse(ce.skypeTeamsData).cid === meetingId) {
			notificationList.push(ce);
			break;
		}
	}
}

// Handlers
function assignActivitiesCountUpdateHandler(controller) {
	controller.eventingService.$on(
		controller.$scope,
		controller.constants.events.notifications.bellCountUpdated,
		() => onActivitiesCountUpdated(controller));

	controller.chatListService.safeSubscribe(
		controller.$scope,
		() => onActivitiesCountUpdated(controller),
		window.teamspace.services.ChatListServiceEvents.EventType_UnreadCount);
	onActivitiesCountUpdated(controller);
}

function assignCallConnectedHandler(controller) {
	controller.eventingService.$on(
		controller.$scope,
		controller.constants.events.calling.callConnected,
		() => onCallConnected());
}

function assignCallDisconnectedHandler(controller) {
	controller.eventingService.$on(
		controller.$scope,
		controller.constants.events.calling.callDisposed,
		() => onCallDisconnected());
}

function assignWorkerMessagingUpdatesHandler(controller) {
	controller.eventingService.$on(
		controller.$scope,
		controller.constants.events.workerMessagingUpdates.messageUpdatesFromWorker,
		(event, data) => onMessageUpdatesFromWorker(controller, data));
}

async function onActivitiesCountUpdated(controller) {
	const count = controller.bellNotificationsService.getNewActivitiesCount() + controller.chatListService.getUnreadCountFromChatList();
	const handlers = getEventHandlers('activities-count-updated');
	for (const handler of handlers) {
		handler.handler({ count: count });
	}
}

async function onCallConnected() {
	const handlers = getEventHandlers('call-connected');
	for (const handler of handlers) {
		handler.handler({});
	}
}

async function onCallDisconnected() {
	const handlers = getEventHandlers('call-disconnected');
	for (const handler of handlers) {
		handler.handler({});
	}
}

async function onMessageUpdatesFromWorker(controller, data) {
	if (Array.isArray(data)) {
		const handlers = getEventHandlers('meeting-started');
		const events = await getActiveMeetingEvents(controller, data);
		for (const e of events) {
			callMeetingStartedEventHandlers(handlers, e);
		}
	}
}

function callMeetingStartedEventHandlers(handlers, e) {
	for (const handler of handlers) {
		handler.handler({
			title: e.subject
		});
	}
}

const activityHub = new ActivityHub();
module.exports = activityHub;
