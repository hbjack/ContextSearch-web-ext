var userOptions;

var quickMenuObject = { 
	delay: 250, // how long to hold right-click before quick menu events in ms
	keyDownTimer: 0,
	mouseDownTimer: 0,
	mouseCoords: {x:0, y:0},
	screenCoords: {x:0, y:0},
	mouseCoordsInit: {x:0, y:0},
	mouseLastClickTime: 0,
	mouseDragDeadzone: 4,
	lastSelectTime: 0,
	locked: false,
	searchTerms: "",
	disabled: false,
	mouseDownTargetIsTextBox: false
};

// context menu options
// window.addEventListener('contextmenu', e => {
	
	// browser.contextMenus.create({
		// id: "showSuggestions",
		// title: browser.i18n.getMessage("ShowSuggestions"),
		// type: "checkbox",
		// checked: userOptions.searchBarSuggestions
	// }, () => {});
	// browser.contextMenus.create({
		// id: "clearHistory",
		// title: browser.i18n.getMessage("ClearSearchHistory")
	// }, () => {});

	// setTimeout(() => {
		// window.addEventListener('mousemove', ()=> {
			// browser.contextMenus.remove("showSuggestions");
			// browser.contextMenus.remove("clearHistory");
		// }, {once: true});
	// }, 1000);
// });

// what was this for? ( page_action is not considered a tab and does not receive userOptions updates )
// setInterval(() => {
	// if ( browser.runtime === undefined ) return;
	// browser.runtime.sendMessage({action: "getUserOptions"}).then( message => {
		// userOptions = message.userOptions || {};
	// });
// }, 1000);

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
	
	if ( message.userOptions ) userOptions = message.userOptions;

	if (typeof message.action !== 'undefined') {
		switch (message.action) {
			case "updateQuickMenuObject":
				quickMenuObject = message.quickMenuObject;
				
				// quickMenuObject can update before userOptions. Grab the lastUsed
				userOptions.lastUsedId = quickMenuObject.lastUsed || userOptions.lastUsedId;
				
				// send event to OpenAsLink tile to enable/disable
				document.dispatchEvent(new CustomEvent('updatesearchterms'));
				break;
		}
	}
});

function getSelectedText(el) {
	return el.value.substring(el.selectionStart, el.selectionEnd);
}

browser.runtime.sendMessage({action: "getUserOptions"}).then( async message => {
	userOptions = message.userOptions || {};
	
	if ( userOptions === {} ) return;
	
	let msg = await browser.runtime.sendMessage({action: "getUserOptions"});
	
	userOptions = msg.userOptions;
		
	makeSearchBar();

	let singleColumn = window == top ? userOptions.searchBarUseOldStyle : userOptions.sideBar.singleColumn;

	makeQuickMenu({type: window == top ? "searchbar" : "sidebar", singleColumn: singleColumn}).then( qme => {
		document.body.appendChild(qme);
		
		if ( userOptions.quickMenuToolsPosition === 'bottom' && userOptions.quickMenuToolsAsToolbar )	
			document.body.appendChild(document.getElementById('toolBar'));
		
		document.dispatchEvent(new CustomEvent('quickMenuIframeLoaded'));

	}).then(() => setTheme())
		.then(() => setUserStyles())
		.then(() => setAllToolIconColors());

});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
	userOptions = message.userOptions || userOptions;
});

document.addEventListener('quickMenuIframeLoaded', () => {

	// combined with inline body style prevents glitching when opening menu
	document.body.style.display = 'block';
		
	qm = document.getElementById('quickMenuElement');
	sb = document.getElementById('searchBar');
	tb = document.getElementById('titleBar');
	sg = document.getElementById('suggestions');
	mb = document.getElementById('menuBar');
	toolBar = document.getElementById('toolBar');

	// focus the searchbar on open
	sb.focus();

	// trigger resize for sidebar. Resize triggers on load in the browser_action
	resizeMenu();
	
	// replace text with selection
	(async () => {
		let results = await browser.runtime.sendMessage({action: "getSelectedText"});
		let text = results.shift();
	
		if ( text ) sb.value = text;
		sb.select();
	})();

});

function toolsHandler(qm) {
	
	qm = qm || document.getElementById('quickMenuElement');
	
	toolBar = document.getElementById('toolBar');
	
	if ( !qm ) return;
	
	if ( ! userOptions.quickMenuToolsAsToolbar && qm.rootNode.parent ) return; // has parent = subfolder
	
	qm.toolsArray.forEach( tool => tool.classList.remove('singleColumn'));
	
	let position = userOptions.quickMenuToolsPosition;
	
	// set tools position
	if ( userOptions.quickMenuToolsAsToolbar && position !== 'hidden' )
		createToolsBar(qm);
	
	if ( !userOptions.quickMenuToolsAsToolbar ) {
		if ( position === "top")
			qm.toolsArray.forEach( (tool, index) => qm.insertBefore(tool, qm.children.item(index)));
		else if ( position === "bottom" )
			qm.toolsArray.forEach( (tool, index) => qm.appendChild( tool ));
	}

	qm.toolsArray.forEach( tool => {
		if ( qm.singleColumn && !userOptions.quickMenuToolsAsToolbar ) tool.classList.add('singleColumn');
	});

	qm.insertBreaks();
}

function toolBarResize(options) {

	options = options || {}
		
	if ( window != top ) return;

	// set fixed width for singleColumn
	if ( qm.singleColumn )
		document.body.style.maxWidth = 330 + "px";

	// minimum toolbar width for Chrome ( Firefox min = 200 )
	document.body.style.minWidth = "200px";

	qm.style.height = null;

	// ignore width resizing if only opening suggestions ( prevents flashing )
	if ( !options.suggestionsResize ) {
		sg.style.width = 0;
		qm.style.width = 0;
		toolBar.style.width = 0;
	}
	
	qm.insertBreaks(); // this is usually handled in the toolsHandler, but currently the toolbar does not use that method

	runAtTransitionEnd(document.body, ["width", "height"], () => {

		let minWindowWidth = Math.max(200, window.innerWidth);

		if ( window.innerHeight < document.documentElement.scrollHeight ) {
			
			let sumHeight = sb.getBoundingClientRect().height + sg.getBoundingClientRect().height + tb.getBoundingClientRect().height + mb.getBoundingClientRect().height + toolBar.getBoundingClientRect().height;
			
			qm.style.height = ( (window.innerHeight < 600 && qm.scrollHeight > (600 - sumHeight) ) ? 600 : window.innerHeight ) - sumHeight + "px";
			
		//	qm.style.height = window.innerHeight - ( sb.getBoundingClientRect().height + sg.getBoundingClientRect().height + tb.getBoundingClientRect().height + mb.getBoundingClientRect().height ) + "px";
		} 

		if (qm.getBoundingClientRect().width < window.innerWidth) {

			let maxWidth = 9999;

			let tileSize = qm.getTileSize();

			if ( !qm.singleColumn )
				maxWidth = Math.max(minWindowWidth, tileSize.width * qm.columns + 30);

			qm.style.width = Math.max( minWindowWidth, Math.min(maxWidth, document.documentElement.scrollWidth) ) + "px";

			let padding = tileSize.width - tileSize.rectWidth;

			let div_width = 'calc(' + 100 / qm.columns + "% - " + padding + "px)";

			qm.querySelectorAll('.tile:not(.singleColumn)').forEach( div => {
				div.style.width = div_width;
			});
		}
		
		tb.style.maxWidth = toolBar.style.maxWidth = toolBar.style.width = document.documentElement.scrollWidth - 10 + "px";
		sg.style.width = document.documentElement.scrollWidth + "px";
				
	});
}

var docked = false;

function sideBarResize(options) {
	
	options = options || {};

	if ( window == top ) return;
	
	// throwing sidebar errors
	if ( !qm ) return;
	
	qm = document.getElementById('quickMenuElement');
	sb = document.getElementById('searchBar');
	tb = document.getElementById('titleBar');
	sg = document.getElementById('suggestions');
	mb = document.getElementById('menuBar');

	let allOtherElsHeight = sb.getBoundingClientRect().height + sg.getBoundingClientRect().height + tb.getBoundingClientRect().height + mb.getBoundingClientRect().height;

	let qm_height = qm.style.height;
	
	let iframeHeight = options.iframeHeight || ( !docked ? userOptions.sideBar.height : 10000 );
	
	qm.style.height = null;
	qm.style.width = null;
	sg.style.width = null;

	qm.style.height = function() {
		// return the full height in some cases
		
		if ( options.suggestionsResize ) return qm_height;
		
		if ( docked ) return `calc(100% - ${allOtherElsHeight}px)`;
		
		// if ( openFolder ) return 
		
		// if ( options.groupMore ) return qm.getBoundingClientRect().height + "px";
		
		return Math.min(iframeHeight - allOtherElsHeight, qm.getBoundingClientRect().height) + "px";
	}();

	// account for scrollbars
	qm.style.width = qm.scrollWidth + qm.offsetWidth - qm.clientWidth + "px";

	window.parent.postMessage({
		action:"resizeSideBarIframe", 
		size: {width: parseFloat( qm.style.width ), height: document.body.offsetHeight}, 
		singleColumn: qm.singleColumn,
		tileSize: qm.getTileSize()
	}, "*");
}

function resizeMenu(o) {
	
	if (!qm) return;
	// store scroll position
	let scrollTop = qm.scrollTop;
	let sgScrollTop = sg.scrollTop;
	
	qm.setDisplay();

	window.addEventListener('message', function resizeDoneListener(e) {
		if ( e.data.action && e.data.action === "resizeDone" ) {
			qm.scrollTop = scrollTop;
			sg.scrollTop = sgScrollTop;
			window.removeEventListener('message', resizeDoneListener);
		}
	});

	toolBarResize(o);
	sideBarResize(o);
	
	qm.scrollTop = scrollTop;
	sg.scrollTop = sgScrollTop;
}

function closeMenuRequest() {
	if ( window == top ) {
		if ( userOptions.searchBarCloseAfterSearch ) window.close();
	} else if ( userOptions.sideBar.closeAfterSearch ) {
		window.parent.postMessage({action: "closeSideBarRequest"}, "*");
	}
}

window.addEventListener('message', e => {

	switch (e.data.action) {
		case "sideBarResize":
			if ( e.data.docked !== undefined ) docked = e.data.docked;
			resizeMenu({iframeHeight: e.data.iframeHeight});
			break;
		
		case "quickMenuIframeLoaded":
			document.dispatchEvent(new CustomEvent('quickMenuIframeLoaded'));
			break;
			
		case "sideBarRebuild":
			let qm = document.getElementById('quickMenuElement');
			
			qm.columns = e.data.columns;

			toolsHandler();
			
			qm.style.height = null;
			qm.style.width = null;

			// reset the minWidth for the tilemenu
			qm.style.minWidth = ( qm.singleColumn ? 1 : qm.columns ) * qm.getTileSize().width + "px";
			
			let rect = document.body.getBoundingClientRect();
			let rect_qm = qm.getBoundingClientRect();

			// send size to parent window for sidebar widget
			window.parent.postMessage({
				action:"resizeSideBarIframe", 
				size: {width: rect_qm.width, height: rect.height}, 
				tileSize: qm.getTileSize(), 
				singleColumn: qm.singleColumn
			}, "*");
			
			break;
	}
});

document.getElementById('closeButton').addEventListener('click', e => {

	if ( window != top )
		window.parent.postMessage({action: "closeSideBar"}, "*");
	else
		window.close();
});

mb.addEventListener('mousedown', e => {
	if ( e.which !== 1 ) return;

	mb.moving = true;

	window.parent.postMessage({action: "handle_dragstart", target: "sideBar", e: {clientX: e.screenX, clientY: e.screenY}}, "*");
});

window.addEventListener('mouseup', e => {
	if ( e.which !== 1 ) return;

	mb.moving = false;
	
	document.body.classList.remove("noMouse");
	
	window.parent.postMessage({action: "handle_dragend", target: "sideBar", e: {clientX: e.screenX, clientY: e.screenY}}, "*");
	
});

window.addEventListener('mousemove', e => {
	if ( e.which !== 1 ) return;
	
	if ( !mb.moving ) return;
	
	// suppress mouse events in iframe to prevent dnd fail
	document.body.classList.add("noMouse");
	
	window.parent.postMessage({action: "handle_dragmove", target: "sideBar", e: {clientX: e.screenX, clientY: e.screenY}}, "*");
});

mb.addEventListener('dblclick', e => {
	if ( e.which !== 1 ) return;

	window.parent.postMessage({action: "handle_dock", target: "sideBar", e: {clientX: e.screenX, clientY: e.screenY}}, "*");
});

if ( window == top ) {
	document.getElementById('minimizeButton').style.display = "none";
}

document.getElementById('minimizeButton').addEventListener('click', e => {
	window.parent.postMessage({action: "minimizeSideBarRequest"}, "*");
});
